"""Config / auth-mode selection tests."""
import pytest

from feed.config import Settings, normalize_ssid


def test_normalize_ssid_from_frame():
    frame = '42["authorization",{"session":"ABC123hash","isDemo":1,"tournamentId":0}]'
    assert normalize_ssid(frame) == "ABC123hash"


def test_normalize_ssid_passthrough():
    assert normalize_ssid("  ABC123hash  ") == "ABC123hash"


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for k in (
        "QX_SSID", "QX_COOKIES", "QX_USER_AGENT", "QX_PROXY", "QX_OTP",
        "QUOTEX_EMAIL", "QUOTEX_PASSWORD", "FEED_ASSETS", "FEED_TIMEFRAMES",
        "QUOTEX_ACCOUNT_MODE",
    ):
        monkeypatch.delenv(k, raising=False)
    # Don't let a real .env leak into unit tests.
    monkeypatch.setattr("feed.config.load_dotenv", lambda *a, **k: None)


def test_login_mode_requires_credentials(monkeypatch):
    s = Settings.from_env()
    assert s.auth_mode == "login"
    assert any("QUOTEX_EMAIL" in p for p in s.problems)


def test_login_mode_ok(monkeypatch):
    monkeypatch.setenv("QUOTEX_EMAIL", "demo@example.com")
    monkeypatch.setenv("QUOTEX_PASSWORD", "s3cret")
    s = Settings.from_env()
    assert s.auth_mode == "login"
    assert s.problems == ()


def test_session_mode_detected_and_valid(monkeypatch):
    monkeypatch.setenv("QX_SSID", "abc123")
    monkeypatch.setenv("QX_COOKIES", "cf_clearance=xyz; __cf_bm=aaa; laravel_session=bbb")
    monkeypatch.setenv("QX_USER_AGENT", "Mozilla/5.0 (X11; Linux x86_64) Chrome/120")
    s = Settings.from_env()
    assert s.auth_mode == "session"
    assert s.problems == ()
    # Login creds not required in session mode.
    assert s.email == "session@local"


def test_session_mode_missing_cf_clearance_warns(monkeypatch):
    monkeypatch.setenv("QX_SSID", "abc123")
    monkeypatch.setenv("QX_COOKIES", "__cf_bm=aaa; laravel_session=bbb")
    monkeypatch.setenv("QX_USER_AGENT", "Mozilla/5.0 Chrome/120")
    s = Settings.from_env()
    assert any("cf_clearance" in p for p in s.problems)


def test_session_mode_missing_ua_flagged(monkeypatch):
    monkeypatch.setenv("QX_SSID", "abc123")
    monkeypatch.setenv("QX_COOKIES", "cf_clearance=xyz")
    s = Settings.from_env()
    assert any("QX_USER_AGENT" in p for p in s.problems)


def test_swapped_ssid_and_ua_detected(monkeypatch):
    # SSID field holds the UA, UA field holds the auth frame — the real bug.
    monkeypatch.setenv("QX_SSID", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
    monkeypatch.setenv(
        "QX_USER_AGENT",
        '42["authorization",{"session":"REALHASH","isDemo":0,"tournamentId":0}]',
    )
    monkeypatch.setenv("QX_COOKIES", "cf_clearance=xyz")
    s = Settings.from_env()
    assert any("swapped" in p for p in s.problems)


def test_ssid_pasted_as_full_frame_is_extracted(monkeypatch):
    monkeypatch.setenv(
        "QX_SSID",
        '42["authorization",{"session":"REALHASH","isDemo":1,"tournamentId":0}]',
    )
    monkeypatch.setenv("QX_COOKIES", "cf_clearance=xyz")
    monkeypatch.setenv("QX_USER_AGENT", "Mozilla/5.0 (X11; Linux x86_64) Chrome/120")
    s = Settings.from_env()
    assert s.ssid == "REALHASH"
    assert s.problems == ()


def test_non_browser_ua_flagged(monkeypatch):
    monkeypatch.setenv("QX_SSID", "REALHASH")
    monkeypatch.setenv("QX_COOKIES", "cf_clearance=xyz")
    monkeypatch.setenv("QX_USER_AGENT", "curl/8.0")
    s = Settings.from_env()
    assert any("Mozilla" in p for p in s.problems)


def test_proxy_passthrough(monkeypatch):
    monkeypatch.setenv("QX_SSID", "abc123")
    monkeypatch.setenv("QX_COOKIES", "cf_clearance=xyz")
    monkeypatch.setenv("QX_USER_AGENT", "UA")
    monkeypatch.setenv("QX_PROXY", "http://user:pass@host:8080")
    s = Settings.from_env()
    assert s.proxy == "http://user:pass@host:8080"
