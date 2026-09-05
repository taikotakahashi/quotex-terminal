"""Health state, Redis heartbeat, and a minimal local HTTP endpoint."""
from __future__ import annotations

import asyncio
import json
import logging
import time

logger = logging.getLogger(__name__)

HEARTBEAT_SEC = 5
STALE_TICK_SEC = 60


class Health:
    def __init__(self, assets: tuple[str, ...]):
        self.started_at = int(time.time())
        self.connected = False
        self.account_mode = "PRACTICE"
        self.balance: float | None = None
        self.reconnects = 0
        self.instruments_count = 0
        self.instruments_refreshed_at = 0
        self.session_expired = False
        self.throttled = False
        self.last_tick: dict[str, float] = {a: 0.0 for a in assets}

    def note_tick(self, asset: str, ts: float) -> None:
        self.last_tick[asset] = ts  # adds the asset if new (dynamic streaming)

    def note_instruments(self, count: int) -> None:
        self.instruments_count = count
        self.instruments_refreshed_at = int(time.time())

    def snapshot(self) -> dict:
        now = time.time()
        tick_age = {
            asset: (round(now - ts, 1) if ts else None)
            for asset, ts in self.last_tick.items()
        }
        stale = [
            a for a, age in tick_age.items()
            if age is None or age > STALE_TICK_SEC
        ]
        fresh_any = any(
            age is not None and age <= STALE_TICK_SEC for age in tick_age.values()
        )
        # "ok" REQUIRES that live data is actually flowing (at least one fresh
        # tick). "connected" alone is not enough — Quotex can authorize the
        # account (balance + catalog) but then refuse the data stream under a
        # partial throttle, which must NOT show as LIVE.
        if self.throttled:
            status = "throttled"
        elif self.session_expired:
            status = "session_expired"
        elif not self.connected:
            status = "disconnected"
        elif not fresh_any:
            status = "stalled"          # connected but no live data flowing
        else:
            status = "ok"
        return {
            "ts": int(now),
            "status": status,
            "session_expired": self.session_expired,
            "throttled": self.throttled,
            "connected": self.connected,
            "account_mode": self.account_mode,
            "balance": self.balance,
            "uptime_sec": int(now) - self.started_at,
            "reconnects": self.reconnects,
            "instruments_count": self.instruments_count,
            "instruments_age_sec": (
                int(now) - self.instruments_refreshed_at
                if self.instruments_refreshed_at else None
            ),
            "tick_age_sec": tick_age,
            "stale_assets": stale,
        }


async def heartbeat_loop(health: Health, publisher) -> None:
    while True:
        snap = health.snapshot()
        try:
            await publisher.set_json("feed:health", snap)
            await publisher.publish_json("feed.health", snap)
        except Exception:
            logger.exception("Health heartbeat publish failed")
        await asyncio.sleep(HEARTBEAT_SEC)


async def serve_http(health: Health, port: int) -> None:
    """GET anything on this port -> current health JSON. Localhost only."""

    async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        try:
            await asyncio.wait_for(reader.readline(), timeout=5)
            body = json.dumps(health.snapshot(), indent=2)
            writer.write(
                "HTTP/1.1 200 OK\r\n"
                "Content-Type: application/json\r\n"
                f"Content-Length: {len(body)}\r\n"
                "Connection: close\r\n\r\n".encode() + body.encode()
            )
            await writer.drain()
        except Exception:
            pass
        finally:
            writer.close()

    server = await asyncio.start_server(handle, "127.0.0.1", port)
    logger.info("Health endpoint on http://127.0.0.1:%d/", port)
    async with server:
        await server.serve_forever()
