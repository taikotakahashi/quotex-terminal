"""Auto-refresh wiring: on expiry, _try_auto_refresh captures a fresh session,
persists it, and returns valid refreshed Settings. The browser capture itself is
mocked here (it's validated live); this locks the glue logic."""
import feed.main as feedmain
import feed.session_capture as sc
from feed.config import Settings
from feed.health import Health


async def test_auto_refresh_applies_and_persists(monkeypatch, tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text("QX_SSID=OLDSSID\nQX_COOKIES=cf_clearance=old\nQX_USER_AGENT=Mozilla/5.0 old\n")
    profile = tmp_path / "profile"
    profile.mkdir()

    monkeypatch.setattr(feedmain, "_env_path", lambda: env_file)
    monkeypatch.setattr(feedmain, "_profile_dir", lambda s: profile)

    async def fake_capture(profile_dir, *, interactive, timeout):
        assert interactive is False  # auto-refresh runs non-interactively
        return ("FRESHSSID999", "cf_clearance=new; laravel_session=x", "Mozilla/5.0 Chrome/999")

    monkeypatch.setattr(sc, "capture_session", fake_capture)
    # Keep Settings.from_env deterministic (no real .env / os.environ bleed).
    monkeypatch.setattr("feed.config.load_dotenv", lambda *a, **k: None)
    for k, v in {
        "QX_SSID": "OLDSSID", "QX_COOKIES": "cf_clearance=old",
        "QX_USER_AGENT": "Mozilla/5.0 old", "FEED_ASSETS": "EURUSD",
    }.items():
        monkeypatch.setenv(k, v)

    settings = Settings.from_env()
    health = Health(settings.assets)
    health.session_expired = True

    new = await feedmain._try_auto_refresh(settings, health)

    assert new is not None
    assert new.ssid == "FRESHSSID999"           # applied
    assert new.problems == ()                    # valid
    assert health.session_expired is False       # cleared
    assert "FRESHSSID999" in env_file.read_text()  # persisted to .env


async def test_auto_refresh_none_when_profile_missing(monkeypatch, tmp_path):
    """If there's no saved profile, auto-refresh gives up (→ falls back to manual)."""
    monkeypatch.setattr(feedmain, "_profile_dir", lambda s: tmp_path / "does-not-exist")
    monkeypatch.setattr("feed.config.load_dotenv", lambda *a, **k: None)
    for k, v in {"QX_SSID": "S", "QX_COOKIES": "cf_clearance=x", "QX_USER_AGENT": "Mozilla/5.0"}.items():
        monkeypatch.setenv(k, v)
    settings = Settings.from_env()
    health = Health(settings.assets)
    assert await feedmain._try_auto_refresh(settings, health) is None
