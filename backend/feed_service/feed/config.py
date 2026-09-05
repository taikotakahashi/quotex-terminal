"""Environment-driven configuration for the feed service."""
from __future__ import annotations

import os
import re
from dataclasses import dataclass, field

from dotenv import load_dotenv, find_dotenv, dotenv_values

VALID_TIMEFRAMES = {5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600}


def read_env_session() -> tuple[str, str, str]:
    """Read QX_SSID / QX_COOKIES / QX_USER_AGENT straight from the .env FILE.

    python-dotenv's load_dotenv won't overwrite an already-set os.environ value,
    so this reads the file directly — used to detect a session that
    `make capture` rewrote while the feed is running.
    """
    path = find_dotenv(usecwd=True)
    vals = dotenv_values(path) if path else {}
    return (
        normalize_ssid((vals.get("QX_SSID") or "").strip()),
        (vals.get("QX_COOKIES") or "").strip(),
        (vals.get("QX_USER_AGENT") or "").strip(),
    )

# The SSID is the "session" value inside the socket.io authorization frame:
#   42["authorization",{"session":"<HASH>","isDemo":1,"tournamentId":0}]
# People commonly paste the whole frame; pull the hash out of it.
_AUTH_FRAME_SESSION = re.compile(r'"session"\s*:\s*"([^"]+)"')


def normalize_ssid(raw: str) -> str:
    """Accept either a bare SSID hash or a full pasted authorization frame."""
    raw = raw.strip()
    m = _AUTH_FRAME_SESSION.search(raw)
    return m.group(1) if m else raw


def normalize_proxy(raw: str) -> str:
    """Accept a proxy as a URL (http://user:pass@host:port) OR the common
    colon form host:port:user:pass / host:port, returning a URL."""
    raw = raw.strip()
    if not raw:
        return ""
    if "://" in raw:
        return raw
    parts = raw.split(":")
    if len(parts) == 4:
        host, port, user, pw = parts
        return f"http://{user}:{pw}@{host}:{port}"
    if len(parts) == 2:
        host, port = parts
        return f"http://{host}:{port}"
    return raw  # leave as-is; validation will flag if unusable


@dataclass(frozen=True)
class Settings:
    email: str
    password: str
    lang: str = "en"
    account_mode: str = "PRACTICE"
    assets: tuple[str, ...] = ()
    stream_all_open: bool = False
    max_stream_assets: int = 0  # 0 = no cap
    timeframes: tuple[int, ...] = (60, 300, 900)
    redis_url: str = "redis://localhost:6379/0"
    health_port: int = 8010
    instruments_refresh_sec: int = 30
    candle_history_size: int = 500
    log_level: str = "INFO"
    # Session mode (recommended): a browser-captured session that has already
    # cleared Cloudflare. When ssid is set, the automated login + OTP are
    # skipped. See DIAGNOSE_WS_403.md.
    ssid: str = ""
    cookies: str = ""
    user_agent: str = ""
    proxy: str = ""
    # Browser TLS fingerprint to impersonate on the WebSocket (curl_cffi). This
    # is what gets past Cloudflare's JA3 check on the ws2 endpoint.
    impersonate: str = "chrome"
    # When the session expires, mint a fresh one automatically by re-driving the
    # saved (logged-in) browser profile on an invisible display. Requires a
    # one-time `make capture` login first.
    auto_refresh: bool = False
    chrome_profile: str = ""
    capture_timeout: int = 90
    # When Quotex throttles the account (refuses to authorize), wait this long
    # before a single quiet retry — retrying fast only prolongs the block.
    throttle_cooldown: int = 1200
    problems: tuple[str, ...] = field(default=(), compare=False)

    @property
    def auth_mode(self) -> str:
        return "session" if self.ssid else "login"

    @classmethod
    def from_env(cls) -> "Settings":
        load_dotenv()  # reads .env from the current directory upward, if present

        problems: list[str] = []

        # --- Session mode (preferred): injected browser session ---------------
        ssid_raw = os.getenv("QX_SSID", "").strip()
        ssid = normalize_ssid(ssid_raw)
        cookies = os.getenv("QX_COOKIES", "").strip()
        user_agent = os.getenv("QX_USER_AGENT", "").strip()
        proxy = normalize_proxy(os.getenv("QX_PROXY", ""))
        session_mode = bool(ssid)

        # Catch the common copy-paste confusion: SSID and User-Agent swapped.
        if session_mode:
            ssid_is_ua = ssid_raw.startswith("Mozilla/")
            ua_has_frame = "authorization" in user_agent or user_agent.startswith("42[")
            if ssid_is_ua or ua_has_frame:
                problems.append(
                    "QX_SSID and QX_USER_AGENT look swapped: QX_SSID should be "
                    "the socket 'session' hash and QX_USER_AGENT should start "
                    "with 'Mozilla/'. Swap them (or re-capture per "
                    "DIAGNOSE_WS_403.md)."
                )
            elif user_agent and not user_agent.startswith("Mozilla/"):
                problems.append(
                    "QX_USER_AGENT does not start with 'Mozilla/'. cf_clearance "
                    "is bound to the exact browser User-Agent — paste "
                    "navigator.userAgent verbatim."
                )

        email = os.getenv("QUOTEX_EMAIL", "").strip()
        password = os.getenv("QUOTEX_PASSWORD", "").strip()

        if session_mode:
            if not cookies:
                problems.append(
                    "QX_SSID is set but QX_COOKIES is empty. Session mode needs "
                    "the browser's cookie string (must include cf_clearance). "
                    "See DIAGNOSE_WS_403.md."
                )
            elif "cf_clearance" not in cookies:
                problems.append(
                    "QX_COOKIES has no cf_clearance cookie — the WebSocket "
                    "handshake will very likely still 403. Re-copy the full "
                    "cookie header from a browser that shows live charts."
                )
            if not user_agent:
                problems.append(
                    "QX_SSID is set but QX_USER_AGENT is empty. cf_clearance is "
                    "bound to the exact User-Agent that obtained it — set it to "
                    "the browser's navigator.userAgent."
                )
            # email is still used as the session-cache key inside pyquotex.
            if not email:
                email = "session@local"
        else:
            if not email or email == "you@example.com":
                problems.append(
                    "No QX_SSID (session mode) and QUOTEX_EMAIL is not set. "
                    "Either capture a browser session (recommended, see "
                    "DIAGNOSE_WS_403.md) or set QUOTEX_EMAIL/QUOTEX_PASSWORD."
                )
            if not password or password == "change-me":
                problems.append(
                    "QUOTEX_PASSWORD is not set (and no QX_SSID session provided)."
                )

        account_mode = os.getenv("QUOTEX_ACCOUNT_MODE", "PRACTICE").strip().upper()
        if account_mode != "PRACTICE":
            problems.append(
                f"QUOTEX_ACCOUNT_MODE={account_mode!r}: the feed service only "
                "supports PRACTICE (demo). It never trades, and a demo session "
                "keeps the real account out of ToS exposure."
            )

        feed_assets_raw = os.getenv("FEED_ASSETS", "EURUSD,GBPUSD,EURUSD_otc").strip()
        stream_all_open = feed_assets_raw.upper() in ("ALL_OPEN", "ALL", "*")
        if stream_all_open:
            assets: tuple[str, ...] = ()
        else:
            assets = tuple(a.strip() for a in feed_assets_raw.split(",") if a.strip())
            if not assets:
                problems.append("FEED_ASSETS is empty — need at least one asset symbol (or ALL_OPEN).")

        timeframes: list[int] = []
        for raw in os.getenv("FEED_TIMEFRAMES", "60,300,900").split(","):
            raw = raw.strip()
            if not raw:
                continue
            try:
                tf = int(raw)
            except ValueError:
                problems.append(f"FEED_TIMEFRAMES entry {raw!r} is not an integer.")
                continue
            if tf not in VALID_TIMEFRAMES:
                problems.append(
                    f"FEED_TIMEFRAMES entry {tf} unsupported "
                    f"(valid: {sorted(VALID_TIMEFRAMES)})."
                )
            else:
                timeframes.append(tf)
        if not timeframes:
            problems.append("FEED_TIMEFRAMES resolved to no valid timeframes.")

        def _int(name: str, default: int, lo: int, hi: int) -> int:
            try:
                val = int(os.getenv(name, str(default)))
            except ValueError:
                problems.append(f"{name} must be an integer.")
                return default
            if not lo <= val <= hi:
                problems.append(f"{name} must be between {lo} and {hi}.")
            return val

        return cls(
            email=email,
            password=password,
            lang=os.getenv("QUOTEX_LANG", "en").strip() or "en",
            account_mode=account_mode,
            assets=assets,
            stream_all_open=stream_all_open,
            max_stream_assets=_int("QX_MAX_STREAM_ASSETS", 0, 0, 200),
            timeframes=tuple(sorted(set(timeframes))),
            redis_url=os.getenv("REDIS_URL", "redis://localhost:6379/0").strip(),
            health_port=_int("HEALTH_PORT", 8010, 1024, 65535),
            instruments_refresh_sec=_int("INSTRUMENTS_REFRESH_SEC", 30, 5, 3600),
            candle_history_size=_int("CANDLE_HISTORY_SIZE", 500, 10, 10_000),
            log_level=os.getenv("LOG_LEVEL", "INFO").strip().upper() or "INFO",
            ssid=ssid,
            cookies=cookies,
            user_agent=user_agent,
            proxy=proxy,
            impersonate=os.getenv("QX_IMPERSONATE", "chrome").strip() or "chrome",
            auto_refresh=os.getenv("QX_AUTO_REFRESH", "").strip().lower() in ("1", "true", "yes", "on"),
            chrome_profile=os.getenv("QX_CHROME_PROFILE", "").strip(),
            capture_timeout=_int("QX_CAPTURE_TIMEOUT", 90, 20, 600),
            throttle_cooldown=_int("QX_THROTTLE_COOLDOWN", 1200, 60, 7200),
            problems=tuple(problems),
        )
