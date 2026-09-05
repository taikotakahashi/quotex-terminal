"""Async WebSocket client for the Quotex API.

Resilience layer
----------------
The client supports automatic reconnect with exponential backoff and a
stale-connection watchdog. Both are governed by
:class:`pyquotex.types.ReconnectPolicy`; pass ``ReconnectPolicy(enabled=False)``
to restore the original single-connection behavior.

Reconnect flow:

1. ``run_forever`` enters an outer loop that keeps trying to connect
   until :attr:`ReconnectPolicy.max_attempts` is reached (``0`` = infinite).
2. On every successful open, the :class:`QuotexAPI` ``_on_open`` hook
   runs as before AND a re-subscription pass replays any streams the
   user had opened (candle, all-size, mood, realtime price).
3. On unexpected close or watchdog timeout, the loop sleeps using
   :func:`pyquotex._api._waits.backoff_sleep` and reconnects.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from curl_cffi import CurlWsFlag
from curl_cffi.requests import AsyncSession

from pyquotex._api._waits import backoff_sleep
from pyquotex.global_value import WebsocketStatus
from pyquotex.types import ReconnectPolicy

logger = logging.getLogger(__name__)

# LOCAL VENDOR PATCH (2026-09-03): the transport was migrated from the
# `websockets` library to curl_cffi's AsyncWebSocket. Cloudflare rejects the
# WebSocket UPGRADE to ws2.qxbroker.com with HTTP 403 when the TLS ClientHello
# is not browser-like (JA3 fingerprinting on the WS endpoint). curl_cffi
# impersonates a real Chrome TLS fingerprint, which Cloudflare accepts.
# See vendor/pyquotex/VENDORED.md.
DEFAULT_IMPERSONATE = "chrome"


class WebsocketClient:
    """Pure-async WebSocket client with optional auto-reconnect."""

    def __init__(
        self,
        api: Any,
        reconnect_policy: ReconnectPolicy | None = None,
    ) -> None:
        """Initialize the WebSocket client.

        Args:
            api: The :class:`QuotexAPI` instance this client belongs to.
            reconnect_policy: Resilience configuration. Defaults to
                :class:`ReconnectPolicy` with auto-reconnect enabled.
        """
        self.api = api
        self.state = api.state
        self.policy = reconnect_policy or ReconnectPolicy()
        self._ws: Any = None
        self._session: AsyncSession | None = None
        self._is_open = False
        self.impersonate = getattr(api, "impersonate", DEFAULT_IMPERSONATE)
        self.proxy_url = getattr(api, "proxy_url", None)
        self._closing = False
        self._watchdog_task: asyncio.Task[None] | None = None
        # Counter of successful opens; the very first open does NOT
        # replay subscriptions (there are none yet).
        self._open_count = 0

    @property
    def wss(self) -> "WebsocketClient":
        """Returns the low-level WebSocket wrapper (self)."""
        return self

    async def send(self, data: str) -> None:
        """Send a frame; log instead of crashing if the socket is closed.

        Socket.IO frames are TEXT. curl_cffi defaults ``send`` to BINARY, which
        the Quotex server silently ignores — so TEXT must be forced.
        """
        if self._ws and self._is_open:
            try:
                await self._ws.send(data, CurlWsFlag.TEXT)
                logger.debug("Sent: %s", data)
            except Exception as e:
                logger.warning("Cannot send (connection closed?): %s", e)

    async def run_forever(
            self,
            url: str,
            extra_headers: dict[str, str] | None = None,
            ssl: Any = None,
            **kwargs: Any,
    ) -> None:
        """Connect to the WebSocket and stay connected.

        With ``ReconnectPolicy.enabled=False`` this method connects once
        and returns when the connection ends. With auto-reconnect on, it
        keeps reconnecting until :meth:`close` is called or
        ``max_attempts`` is exceeded.
        """
        attempt = 0
        while True:
            try:
                await self._connect_once(url, extra_headers, ssl)
                if self._closing:
                    return
                attempt = 0  # successful run resets the backoff
            except Exception as e:
                # curl_cffi raises on both clean close and error; treat a close
                # while we already had an open socket as a close, otherwise an
                # error (e.g. the initial handshake failing / a 403).
                if self._open_count > 0 and self._is_open is False:
                    self._handle_close_exception(e)
                else:
                    logger.error("WebSocket error: %s", e)
                    self.api._on_error(e)

            if not self.policy.enabled or self._closing:
                return
            if self.policy.max_attempts and attempt >= self.policy.max_attempts:
                logger.error(
                    "WebSocket auto-reconnect giving up after %d attempts",
                    attempt,
                )
                return

            logger.info("WebSocket reconnecting (attempt #%d)", attempt + 1)
            await backoff_sleep(
                attempt,
                base=self.policy.base_delay,
                cap=self.policy.max_delay,
                jitter=self.policy.jitter,
            )
            attempt += 1

    async def _connect_once(
            self,
            url: str,
            extra_headers: dict[str, str] | None,
            ssl: Any,
    ) -> None:
        """One ``connect()`` cycle. Returns when the connection ends.

        Uses curl_cffi's AsyncWebSocket with browser impersonation so the TLS
        handshake passes Cloudflare's JA3 check on the ws2 endpoint. The ``ssl``
        argument is ignored (curl handles TLS via ``impersonate``); it is kept
        for signature compatibility with the previous websockets-based client.
        """
        headers = extra_headers or {}
        async with AsyncSession() as session:
            self._session = session
            ws_kwargs = dict(
                headers=headers,
                impersonate=self.impersonate,
                max_recv_speed=0,
            )
            if self.proxy_url:
                ws_kwargs["proxy"] = self.proxy_url
            ws = await session.ws_connect(url, **ws_kwargs)
            self._ws = ws
            self._is_open = True
            self.api.last_message_at = time.monotonic()
            await self.api._on_open()
            self._open_count += 1
            if self._open_count > 1:
                asyncio.create_task(self._replay_subscriptions())

            self._start_watchdog()
            try:
                while self._is_open:
                    frame = await ws.recv()
                    # curl_cffi returns (data, frame_meta); tolerate a bare value.
                    data = frame[0] if isinstance(frame, tuple) else frame
                    if data is None or data == b"":
                        continue
                    await self.api._on_message(data)
            finally:
                self._is_open = False
                self._stop_watchdog()

    def _handle_close_exception(self, exc: Exception) -> None:
        logger.info("WebSocket closed: %s", exc)
        self.api._on_close(1006, str(exc))

    # ------------------------------------------------------------------
    # Stale-connection watchdog
    # ------------------------------------------------------------------
    def _start_watchdog(self) -> None:
        if self.policy.stale_timeout <= 0:
            return
        self._watchdog_task = asyncio.create_task(self._watchdog_loop())

    def _stop_watchdog(self) -> None:
        if self._watchdog_task and not self._watchdog_task.done():
            self._watchdog_task.cancel()
        self._watchdog_task = None

    async def _watchdog_loop(self) -> None:
        timeout = self.policy.stale_timeout
        try:
            while self._ws is not None and self._is_open:
                await asyncio.sleep(min(timeout / 3.0, 10.0))
                silent_for = time.monotonic() - self.api.last_message_at
                if silent_for > timeout:
                    logger.warning(
                        "WebSocket idle for %.1fs (>%ds); recycling.",
                        silent_for, timeout,
                    )
                    self._is_open = False
                    try:
                        await self._ws.close()
                    except Exception:
                        pass
                    return
        except asyncio.CancelledError:
            pass

    # ------------------------------------------------------------------
    # Subscription replay after reconnect
    # ------------------------------------------------------------------
    async def _replay_subscriptions(self) -> None:
        """Re-issue every tracked subscription after a successful reconnect."""
        try:
            for _ in range(40):  # ~2 s
                if self.state.status == WebsocketStatus.CONNECTED:
                    break
                await asyncio.sleep(0.05)
        except Exception:  # pragma: no cover
            pass

        subs = list(getattr(self.api, "_subscriptions", {}).values())
        for sub in subs:
            try:
                await self._replay_one(sub)
            except Exception as e:
                logger.warning(
                    "Failed to replay subscription kind=%s asset=%s: %s",
                    sub.kind, sub.asset, e,
                )

    async def _replay_one(self, sub: Any) -> None:
        api = self.api
        if sub.kind == "candle":
            await api.subscribe_realtime_candle(sub.asset, sub.period or 0)
            await api.chart_notification(sub.asset)
            await api.follow_candle(sub.asset)
        elif sub.kind == "candle_all_size":
            await api.subscribe_all_size(sub.asset)
        elif sub.kind == "mood":
            instrument = sub.extra.get("instrument", "turbo-option")
            await api.subscribe_Traders_mood(sub.asset, instrument)
        elif sub.kind == "realtime_price":
            await api.subscribe_realtime_candle(sub.asset, sub.period or 0)

    async def close(self) -> None:
        """Close the websocket gracefully and stop auto-reconnect."""
        self._closing = True
        self.policy = ReconnectPolicy(enabled=False)
        self._stop_watchdog()
        self._is_open = False
        if self._ws:
            try:
                await self._ws.close()
            except Exception:
                pass

    def is_alive(self) -> bool:
        """Return True iff the underlying socket is currently OPEN."""
        return self._ws is not None and self._is_open
