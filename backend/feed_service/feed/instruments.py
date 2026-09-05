"""Live asset catalog + payout publisher.

Quotex broadcasts instruments as positional arrays. The indices used here
mirror pyquotex's AssetsMixin.get_payment() (vendor/pyquotex). If Quotex
reshapes the payload, this module and the vendored lib are the two places
to patch.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

logger = logging.getLogger(__name__)

_CRYPTO = {
    "BTC", "ETH", "LTC", "XRP", "ADA", "DOT", "SOL", "DOGE", "BNB", "TRX",
    "AVA", "MAT", "LNK", "TON", "SHI", "PEP",
}
_COMMODITY_PREFIXES = ("XAU", "XAG", "XPT", "XPD", "UKBRENT", "USCRUDE", "BRENT", "WTI")


def classify_asset(symbol: str) -> str:
    """Best-effort category from the symbol (Quotex doesn't label these)."""
    base = symbol.removesuffix("_otc").upper()
    if base.startswith(_COMMODITY_PREFIXES):
        return "commodity"
    if base[:3] in _CRYPTO or base.endswith(("USDT", "BTC")):
        return "crypto"
    if len(base) == 6 and base.isalpha():
        return "currency"
    return "other"  # stocks, indices, composites


def parse_instrument(row: list[Any]) -> dict[str, Any] | None:
    """One positional instrument row -> a stable, named dict."""
    try:
        symbol = row[1]
        return {
            "code": row[0],
            "symbol": symbol,
            "name": str(row[2]).replace("\n", ""),
            "category": classify_asset(symbol),
            "is_otc": symbol.endswith("_otc"),
            "open": bool(row[14]),
            "payout": row[5],              # standard payout %
            "turbo_payout": row[18],       # short-expiry payout %
            "profit": {"24H": row[-10], "1M": row[-9], "5M": row[-8]},
        }
    except (IndexError, TypeError):
        logger.warning("Unparseable instrument row (len=%s): %.120s", len(row), row)
        return None


class InstrumentsPublisher:
    """Periodically refreshes the catalog and publishes snapshot + changes."""

    def __init__(self, client, publisher, health, refresh_sec: int):
        self.client = client
        self.publisher = publisher
        self.health = health
        self.refresh_sec = refresh_sec
        self._last: dict[str, dict[str, Any]] = {}

    async def run(self) -> None:
        while True:
            try:
                await self.refresh_once()
            except Exception:
                logger.exception("Instruments refresh failed")
            await asyncio.sleep(self.refresh_sec)

    async def refresh_once(self) -> None:
        rows = await self.client.get_instruments()
        catalog = {}
        for row in rows:
            parsed = parse_instrument(row)
            if parsed:
                catalog[parsed["symbol"]] = parsed

        if not catalog:
            logger.warning("Instruments refresh returned no assets")
            return

        changed = [
            sym for sym, data in catalog.items()
            if self._last.get(sym) != data
        ]
        removed = [sym for sym in self._last if sym not in catalog]

        snapshot = {
            "ts": int(time.time()),
            "count": len(catalog),
            "assets": sorted(catalog.values(), key=lambda a: a["symbol"]),
        }
        await self.publisher.set_json("feed:assets", snapshot)
        await self.publisher.publish_json(
            "feed.assets",
            {
                "ts": snapshot["ts"],
                "count": len(catalog),
                "open_count": sum(1 for a in catalog.values() if a["open"]),
                "changed": changed[:50],
                "removed": removed,
            },
        )
        self.health.note_instruments(len(catalog))
        if self._last and (changed or removed):
            logger.info(
                "Catalog updated: %d assets, %d changed, %d removed",
                len(catalog), len(changed), len(removed),
            )
        elif not self._last:
            logger.info("Catalog loaded: %d assets", len(catalog))
        self._last = catalog
