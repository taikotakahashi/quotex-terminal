"""Subscriber filtering helpers."""
from __future__ import annotations

from typing import Any

# Prefer shared prefs from web_api when installed; fall back for isolated tests.
try:
    from webapi.telegram_prefs import normalize_prefs, prefs_ready_for_alerts
except ImportError:  # pragma: no cover
    def normalize_prefs(raw: dict[str, Any] | None) -> dict[str, Any]:
        return {
            "results": True,
            "timeframes": [60, 300, 900],
            "markets": [],
            "lang": "pt",
            "min_confidence": 90,
            "min_payout": 0,
            "setup_complete": True,
            **(raw or {}),
        }

    def prefs_ready_for_alerts(prefs: dict[str, Any] | None) -> bool:
        p = normalize_prefs(prefs if isinstance(prefs, dict) else None)
        if not p.get("setup_complete", True):
            return False
        return bool(p.get("timeframes"))


def should_send_signal(
    prefs: dict[str, Any] | None,
    *,
    enabled: bool,
    timeframe: int,
    category: str | None,
    confidence: float,
    payout: float | None,
) -> bool:
    if not enabled:
        return False
    if not prefs_ready_for_alerts(prefs):
        return False
    p = normalize_prefs(prefs if isinstance(prefs, dict) else None)
    tfs = p.get("timeframes") or []
    if tfs and int(timeframe) not in tfs:
        return False
    markets = p.get("markets") or []
    if markets and category and category not in markets:
        return False
    if markets and not category:
        return False
    if float(confidence) < float(p.get("min_confidence") or 0):
        return False
    min_payout = float(p.get("min_payout") or 0)
    if min_payout > 0 and (payout is None or float(payout) < min_payout):
        return False
    return True


def should_send_result(prefs: dict[str, Any] | None, *, enabled: bool, timeframe: int, category: str | None) -> bool:
    if not enabled:
        return False
    if not prefs_ready_for_alerts(prefs):
        return False
    p = normalize_prefs(prefs if isinstance(prefs, dict) else None)
    if not p.get("results", True):
        return False
    tfs = p.get("timeframes") or []
    if tfs and int(timeframe) not in tfs:
        return False
    markets = p.get("markets") or []
    if markets and category and category not in markets:
        return False
    if markets and not category:
        return False
    return True
