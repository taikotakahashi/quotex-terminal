"""Thin supervision wrapper around the vendored pyquotex client.

Everything the rest of the service needs from Quotex goes through this class,
so a protocol change in the unofficial API is patched here + vendor/pyquotex
and nowhere else.
"""
from __future__ import annotations

import asyncio
import logging
import os
import time

from pyquotex.stable_api import Quotex
from pyquotex.types import ReconnectPolicy

from .config import Settings

logger = logging.getLogger(__name__)

CONNECT_BACKOFF = (10, 20, 40, 80, 120)
WATCHDOG_INTERVAL = 20

# GLOBAL floor on how often ANY connection attempt may happen (process-wide),
# across every reconnect path. This is the single most important anti-throttle
# guard: it makes a reconnect storm impossible.
MIN_CONNECT_INTERVAL = 25.0
_last_connect_attempt = 0.0

# Gentle auto-reconnect for the underlying pyquotex WS: long backoff instead of
# the default 1s hammering, so a dropped/refused connection doesn't spam Quotex.
GENTLE_RECONNECT = ReconnectPolicy(
    enabled=True, max_attempts=0, base_delay=15.0, max_delay=180.0,
    jitter=0.3, stale_timeout=90.0,
)

# Substrings of upstream login errors that retrying can never fix. Repeated
# failed logins with bad credentials also risk flagging the account/IP.
AUTH_FAIL_MARKERS = ("invalid email or password", "incorrect password", "user not found")

# The WebSocket opened but Quotex rejected the session authorization — the SSID
# is expired/invalid. Retrying won't help; a fresh session is needed.
SESSION_EXPIRED_MARKERS = ("authorization_rejected", "authorization/reject")

# The WebSocket opened + handshook, but Quotex refused to authorize (silently
# disconnected the namespace) — even a real browser gets this. Usually the
# account/IP is temporarily throttled by Quotex's anti-abuse.
SESSION_REFUSED_MARKERS = ("session_refused",)

_SESSION_REFUSED_HELP = (
    "Quotex accepted the connection but REFUSED to authorize the account "
    "(it disconnected without authorizing — a real browser is refused the same "
    "way). This is a Quotex-side block, not a code or session problem, and it is "
    "usually a TEMPORARY rate-limit/anti-abuse throttle after many logins / "
    "connections from one account or IP in a short time.\n"
    "  • Wait ~15-60 min and try again (it typically clears on its own).\n"
    "  • Reduce churn: avoid rapid repeated --check / make capture / restarts, "
    "and consider a smaller FEED_ASSETS while testing.\n"
    "  • If it persists for hours, the demo account or IP may be flagged — a "
    "fresh demo account or a different (residential) IP would confirm."
)

# The WebSocket handshake itself was rejected (Cloudflare 403 / network).
WS_FORBIDDEN_MARKERS = ("403", "websocket connection rejected", "rejected websocket")

_SESSION_EXPIRED_HELP = (
    "Quotex rejected the session authorization — your QX_SSID has EXPIRED or "
    "been invalidated (this happens after some time, when the browser session "
    "ends, or when the account logs in again elsewhere). The WebSocket itself "
    "connected fine. Fix, pick one:\n"
    "  • Session mode: re-capture a FRESH QX_SSID/QX_COOKIES/QX_USER_AGENT from "
    "a browser currently showing live Quotex charts (see DIAGNOSE_WS_403.md).\n"
    "  • Login mode (auto-refreshes): clear QX_SSID and set QUOTEX_EMAIL/"
    "QUOTEX_PASSWORD; the feed logs in and mints a fresh session each run "
    "(may ask for an email OTP the first time)."
)

_WS_403_HELP = (
    "Quotex's realtime WebSocket handshake was rejected (HTTP 403). This is a "
    "transport/Cloudflare-fingerprint or network issue (not the session). Check "
    "QX_IMPERSONATE (default 'chrome'), and DIAGNOSE_WS_403.md."
)


class SessionExpired(ConnectionError):
    """Raised when Quotex rejects the SSID authorization (expired/invalid)."""


class SessionRefused(ConnectionError):
    """Raised when Quotex refuses to authorize the account (anti-abuse throttle).

    Distinct from SessionExpired: a fresh session does NOT help — the account/IP
    is temporarily blocked. The right response is to back off quietly.
    """


class QuotexFeedClient:
    def __init__(self, settings: Settings, health):
        self.settings = settings
        self.health = health
        proxies = {"https": settings.proxy, "http": settings.proxy} if settings.proxy else None
        qx_kwargs = dict(
            email=settings.email,
            password=settings.password,
            lang=settings.lang,
            impersonate=settings.impersonate,
            reconnect_policy=GENTLE_RECONNECT,
        )
        if proxies:
            qx_kwargs["proxies"] = proxies
        if settings.auth_mode == "session":
            # A modern browser UA is required so cf_clearance matches; the
            # library also reads user_agent from here for the WS handshake.
            qx_kwargs["user_agent"] = settings.user_agent
        self.qx = Quotex(**qx_kwargs)
        # Route the realtime WebSocket (curl_cffi) through the proxy too, not
        # just the HTTP login. The vendored ws client reads this attribute.
        self.qx.proxy_url = settings.proxy or None

        if settings.auth_mode == "session":
            # Inject the browser session; pyquotex then skips login + OTP.
            self.qx.set_session(
                user_agent=settings.user_agent,
                cookies=settings.cookies,
                ssid=settings.ssid,
            )
        else:
            self.qx.on_otp_callback = self._otp_callback

        self.qx.set_account_mode("PRACTICE")
        self._subscribed: set[str] = set()
        self._reconnect_lock = asyncio.Lock()
        # Set when the session is rejected mid-run; the service loop watches it.
        self._expired = asyncio.Event()

    @staticmethod
    async def _respect_connect_floor() -> None:
        """Block until at least MIN_CONNECT_INTERVAL has passed since the last
        connection attempt anywhere in the process — prevents reconnect storms."""
        global _last_connect_attempt
        wait = MIN_CONNECT_INTERVAL - (time.monotonic() - _last_connect_attempt)
        if wait > 0:
            await asyncio.sleep(wait)
        _last_connect_attempt = time.monotonic()

    @staticmethod
    def _otp_callback(prompt: str) -> str:
        """Supply the email PIN without blocking a headless service.

        Prefers QX_OTP from the environment; falls back to an interactive
        prompt only when a terminal is attached.
        """
        code = os.getenv("QX_OTP", "").strip()
        if code:
            return code
        if os.isatty(0):
            return input(prompt)
        raise RuntimeError(
            "Quotex asked for an email OTP but no terminal is attached and "
            "QX_OTP is unset. Use Session mode (QX_SSID/QX_COOKIES/"
            "QX_USER_AGENT) for unattended runs — see DIAGNOSE_WS_403.md."
        )

    async def connect(self, max_attempts: int | None = None) -> None:
        """Connect + authenticate, with exponential backoff.

        max_attempts=None retries forever (service mode); a finite number is
        used by `quotex-feed --check`.
        """
        attempt = 0
        while True:
            attempt += 1
            await self._respect_connect_floor()
            try:
                ok, reason = await self.qx.connect()
            except Exception as exc:  # network/cloudflare/protocol errors
                ok, reason = False, f"{type(exc).__name__}: {exc}"

            if ok:
                self.health.connected = True
                try:
                    self.health.balance = await self.qx.get_balance()
                except Exception:
                    logger.warning("Connected, but balance fetch failed", exc_info=True)
                logger.info(
                    "Connected to Quotex (PRACTICE). Balance: %s",
                    self.health.balance,
                )
                return

            self.health.connected = False
            reason_l = str(reason).lower()
            if any(marker in reason_l for marker in AUTH_FAIL_MARKERS):
                raise ConnectionError(
                    f"Quotex rejected the credentials ({reason}). "
                    "Not retrying — check QUOTEX_EMAIL/QUOTEX_PASSWORD in .env."
                )
            if any(marker in reason_l for marker in SESSION_EXPIRED_MARKERS):
                # A fresh session is required; retrying with the same SSID is futile.
                raise SessionExpired(_SESSION_EXPIRED_HELP)
            if any(marker in reason_l for marker in SESSION_REFUSED_MARKERS):
                # Quotex is refusing the account (throttled); retrying fast makes
                # it worse. Signal a long, quiet back-off.
                raise SessionRefused(_SESSION_REFUSED_HELP)
            if any(marker in reason_l for marker in WS_FORBIDDEN_MARKERS):
                # Identical retries won't clear a Cloudflare 403 and just hammer
                # the endpoint. Stop and tell the operator how to fix it.
                raise ConnectionError(_WS_403_HELP)
            if max_attempts is not None and attempt >= max_attempts:
                raise ConnectionError(f"Quotex login failed: {reason}")

            delay = CONNECT_BACKOFF[min(attempt - 1, len(CONNECT_BACKOFF) - 1)]
            logger.warning(
                "Quotex connect attempt %d failed (%s); retrying in %ds",
                attempt, reason, delay,
            )
            await asyncio.sleep(delay)

    async def watchdog(self) -> None:
        """Detects dropped/deauthenticated sessions and restores them."""
        while True:
            await asyncio.sleep(WATCHDOG_INTERVAL)
            try:
                alive = await self.qx.check_connect()
            except Exception:
                alive = False

            if alive:
                self.health.connected = True
                continue

            self.health.connected = False
            async with self._reconnect_lock:
                logger.warning("Session lost — reconnecting")
                self.health.reconnects += 1
                try:
                    await self.connect()
                except SessionExpired:
                    # A fresh session is needed; signal the service loop, which
                    # waits for a refreshed .env and restarts the connection.
                    self.health.session_expired = True
                    self._expired.set()
                    while True:  # stop reconnecting; the service loop tears us down
                        await asyncio.sleep(3600)
                try:
                    await self.qx.re_subscribe_stream()
                    logger.info("Streams re-subscribed after reconnect")
                except Exception:
                    logger.exception("Re-subscribe failed; streams will retry")
                    self._subscribed.clear()

    async def get_instruments(self) -> list:
        return await self.qx.get_instruments()

    async def subscribe_asset(self, asset: str) -> None:
        if asset in self._subscribed:
            return
        await self.qx.start_candles_stream(asset, period=60)
        self._subscribed.add(asset)

    async def get_ticks(self, asset: str) -> list[dict]:
        """Recent ticks as [{'time': unix_ts, 'price': float}, ...]."""
        return await self.qx.get_realtime_price(asset)

    async def close(self) -> None:
        try:
            await self.qx.close()
        except Exception:
            pass
