"""Default Telegram notification preferences (shared by API + bot)."""
from __future__ import annotations

from typing import Any

# Empty markets = all categories. Allowed values match feed instrument categories.
ALLOWED_MARKETS = ("currency", "crypto", "commodity", "other")

DEFAULT_TELEGRAM_PREFS: dict[str, Any] = {
    "results": True,
    "timeframes": [60, 300, 900],
    "markets": [],
    "lang": "pt",
    "min_confidence": 90,
    "min_payout": 0,
    # Missing / True = already onboarded (legacy links). New links set False until wizard finishes.
    "setup_complete": True,
}


def normalize_prefs(raw: dict[str, Any] | None) -> dict[str, Any]:
    base = dict(DEFAULT_TELEGRAM_PREFS)
    if not raw:
        return base
    if "results" in raw:
        base["results"] = bool(raw["results"])
    if "lang" in raw and raw["lang"] in ("pt", "en", "es"):
        base["lang"] = raw["lang"]
    if "min_confidence" in raw:
        try:
            base["min_confidence"] = max(0, min(99, int(raw["min_confidence"])))
        except (TypeError, ValueError):
            pass
    if "min_payout" in raw:
        try:
            base["min_payout"] = max(0, min(100, int(raw["min_payout"])))
        except (TypeError, ValueError):
            pass
    if isinstance(raw.get("timeframes"), list):
        tfs = []
        for x in raw["timeframes"]:
            try:
                tf = int(x)
            except (TypeError, ValueError):
                continue
            if tf in (60, 300, 900) and tf not in tfs:
                tfs.append(tf)
        base["timeframes"] = tfs
    if isinstance(raw.get("markets"), list):
        markets = []
        for m in raw["markets"]:
            if isinstance(m, str) and m.strip() in ALLOWED_MARKETS and m.strip() not in markets:
                markets.append(m.strip())
        base["markets"] = markets
    if "setup_complete" in raw:
        base["setup_complete"] = bool(raw["setup_complete"])
    return base


def prefs_ready_for_alerts(prefs: dict[str, Any] | None) -> bool:
    """True when the user finished the /start wizard (or is a legacy link)."""
    p = normalize_prefs(prefs if isinstance(prefs, dict) else None)
    if not p.get("setup_complete", True):
        return False
    return bool(p.get("timeframes"))