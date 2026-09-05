"""Feed service entrypoint.

    quotex-feed          run the service (connect, stream, publish, supervise)
    quotex-feed --check  validate config, Redis, login, and catalog, then exit
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import os
import signal
import sys
from pathlib import Path

from dotenv import find_dotenv

from .candles import CandleStreamer
from .config import Settings, read_env_session
from .health import Health, heartbeat_loop, serve_http
from .instruments import InstrumentsPublisher, parse_instrument
from .publisher import RedisPublisher
from .quotex_client import QuotexFeedClient, SessionExpired, SessionRefused
from .signals import SignalEngine

SESSION_POLL_SEC = 3


def _env_path() -> Path:
    found = find_dotenv(usecwd=True)
    return Path(found) if found else Path(".env")


def _profile_dir(settings: Settings) -> Path:
    if settings.chrome_profile:
        return Path(settings.chrome_profile)
    return _env_path().parent / ".chrome-capture"


def _apply_env_session(ssid: str, cookies: str, ua: str) -> Settings:
    os.environ["QX_SSID"] = ssid
    if cookies:
        os.environ["QX_COOKIES"] = cookies
    if ua:
        os.environ["QX_USER_AGENT"] = ua
    return Settings.from_env()

logger = logging.getLogger("feed")

TASK_RESTART_DELAY = 5


def _setup_logging(level: str) -> None:
    logging.basicConfig(
        level=getattr(logging, level, logging.INFO),
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
        stream=sys.stdout,
    )
    logging.getLogger("websockets").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)


def _load_settings_or_exit() -> Settings:
    settings = Settings.from_env()
    if settings.problems:
        print("Configuration problems:\n", file=sys.stderr)
        for p in settings.problems:
            print(f"  ✗ {p}", file=sys.stderr)
        print(
            "\nFix the above in your .env (see .env.example) and retry.",
            file=sys.stderr,
        )
        raise SystemExit(2)
    return settings


async def _supervised(name: str, coro_factory) -> None:
    """Run a task forever; on crash, log and restart after a delay."""
    while True:
        try:
            await coro_factory()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Task %s crashed; restarting in %ds", name, TASK_RESTART_DELAY)
            await asyncio.sleep(TASK_RESTART_DELAY)


async def _sleep_or_stop(seconds: float, stop: asyncio.Event) -> None:
    try:
        await asyncio.wait_for(stop.wait(), timeout=seconds)
    except asyncio.TimeoutError:
        pass


async def _publish_health(publisher: RedisPublisher, health: Health) -> None:
    try:
        snap = health.snapshot()
        await publisher.set_json("feed:health", snap)
        await publisher.publish_json("feed.health", snap)
    except Exception:
        pass


async def _try_auto_refresh(settings: Settings, health: Health) -> Settings | None:
    """Mint a fresh session by re-driving the saved (logged-in) browser profile
    on an invisible display. Returns refreshed Settings, or None if it couldn't
    (e.g. the profile is logged out, or Playwright/Chrome unavailable)."""
    from .session_capture import capture_session, write_env_session

    profile = _profile_dir(settings)
    if not profile.exists():
        logger.warning(
            "Auto-refresh: no saved browser profile at %s — run `make capture` "
            "once to log in.", profile,
        )
        return None
    logger.info("Auto-refresh: driving the saved browser profile to mint a new session…")
    result = await capture_session(profile, interactive=False, timeout=settings.capture_timeout)
    if not result:
        logger.warning("Auto-refresh attempt produced no session (profile logged out?).")
        return None
    ssid, cookies, ua = result
    try:
        write_env_session(_env_path(), ssid, cookies, ua)
    except Exception:
        logger.exception("Auto-refresh: failed to persist session to .env")
    new = _apply_env_session(ssid, cookies, ua)
    if new.problems:
        logger.warning("Auto-refresh produced an invalid session: %s", "; ".join(new.problems))
        return None
    logger.info("Auto-refresh succeeded — reconnecting.")
    health.session_expired = False
    return new


async def _recover_session(
    settings: Settings, health: Health, publisher: RedisPublisher, stop: asyncio.Event
) -> Settings:
    """Obtain a fresh session after expiry. If QX_AUTO_REFRESH is on, keep
    attempting an automatic (invisible) refresh; always also watch backend/.env
    so a manual `make capture` is picked up. Keeps the dashboard status current."""
    health.session_expired = True
    old = settings.ssid
    if settings.auto_refresh:
        logger.warning("Session expired — attempting automatic refresh (and watching .env).")
    else:
        logger.warning(
            "Session expired — run `make capture` (or edit backend/.env). The feed "
            "reconnects automatically; no restart needed. "
            "Tip: set QX_AUTO_REFRESH=true for hands-free refresh."
        )

    while not stop.is_set():
        await _publish_health(publisher, health)

        if settings.auto_refresh:
            new = await _try_auto_refresh(settings, health)
            if new:
                return new

        # Manual refresh: did backend/.env get a new SSID?
        ssid, cookies, ua = read_env_session()
        if ssid and ssid != old:
            new = _apply_env_session(ssid, cookies, ua)
            if not new.problems:
                logger.info("Detected a refreshed session in .env — reconnecting.")
                health.session_expired = False
                return new
            logger.warning("Refreshed .env still has problems: %s", "; ".join(new.problems))
            old = ssid

        # Poll .env often; auto-refresh already paces itself (the browser step
        # takes many seconds), so a short sleep here is fine either way.
        await _sleep_or_stop(SESSION_POLL_SEC if not settings.auto_refresh else 10, stop)
    return settings


async def _cooldown_throttle(
    settings: Settings, health: Health, publisher: RedisPublisher, stop: asyncio.Event
) -> None:
    """Quotex is throttling the account. Sit quietly for the cooldown (a single
    long wait, NOT rapid retries — hammering only prolongs the block), keeping
    the dashboard status as 'throttled', then return to try once more."""
    health.throttled = True
    health.connected = False
    mins = settings.throttle_cooldown // 60
    logger.warning(
        "Quotex is throttling the account (anti-abuse). Backing off quietly for "
        "~%d min before ONE retry — avoid running `make check`/restarts meanwhile, "
        "which re-triggers it. See DIAGNOSE_WS_403.md.", mins,
    )
    waited = 0
    while waited < settings.throttle_cooldown and not stop.is_set():
        await _publish_health(publisher, health)
        await _sleep_or_stop(15, stop)
        waited += 15
    health.throttled = False


async def _asset_manager(
    client, publisher, health, settings: Settings, signal_engine
) -> None:
    """Dynamically stream ALL currently-open assets: subscribe to newly-opened
    ones and drop newly-closed ones, re-evaluating from the live catalog."""
    streamers: dict[str, asyncio.Task] = {}
    try:
        while True:
            try:
                rows = await client.get_instruments()
                open_assets = {
                    p["symbol"] for r in rows
                    if (p := parse_instrument(r)) and p["open"]
                }
                if settings.max_stream_assets:
                    open_assets = set(sorted(open_assets)[: settings.max_stream_assets])

                for asset in sorted(open_assets - streamers.keys()):
                    s = CandleStreamer(
                        client, publisher, health, asset,
                        settings.timeframes, settings.candle_history_size,
                        signal_engine=signal_engine,
                    )
                    streamers[asset] = asyncio.create_task(
                        _supervised(f"candles:{asset}", s.run)
                    )
                    # Pace new subscriptions — a burst of dozens at once looks
                    # bot-like to Quotex's anti-abuse. Spread them out.
                    await asyncio.sleep(0.4)
                for asset in streamers.keys() - open_assets:
                    streamers.pop(asset).cancel()

                logger.info("Streaming %d open assets", len(streamers))
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Asset manager reconcile failed")
            await asyncio.sleep(settings.instruments_refresh_sec)
    finally:
        for t in streamers.values():
            t.cancel()
        await asyncio.gather(*streamers.values(), return_exceptions=True)


async def run_service(settings: Settings) -> None:
    health = Health(settings.assets)
    publisher = RedisPublisher(settings.redis_url)
    await publisher.ping()
    logger.info("Redis OK at %s", settings.redis_url)

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)

    # Health publishing runs continuously, across reconnect cycles, so the
    # dashboard always reflects the current state (incl. 'session_expired').
    infra = [
        asyncio.create_task(_supervised("heartbeat", lambda: heartbeat_loop(health, publisher))),
        asyncio.create_task(_supervised("health-http", lambda: serve_http(health, settings.health_port))),
    ]

    while not stop.is_set():
        client = QuotexFeedClient(settings, health)
        try:
            await client.connect()
        except SessionExpired:
            await client.close()
            settings = await _recover_session(settings, health, publisher, stop)
            continue  # rebuild the client with the refreshed session
        except SessionRefused:
            await client.close()
            await _cooldown_throttle(settings, health, publisher, stop)
            continue  # quiet retry with the SAME session after the cooldown
        except ConnectionError as exc:
            logger.error("Fatal connection error: %s", exc)
            await client.close()
            break
        if stop.is_set():
            await client.close()
            break

        health.session_expired = False
        instruments = InstrumentsPublisher(
            client, publisher, health, settings.instruments_refresh_sec
        )
        signal_engine = SignalEngine(publisher, publisher.get_candles)
        stream_tasks = [
            asyncio.create_task(_supervised("watchdog", client.watchdog)),
            asyncio.create_task(_supervised("instruments", instruments.run)),
        ]
        if settings.stream_all_open:
            stream_tasks.append(
                asyncio.create_task(_supervised(
                    "asset-manager",
                    lambda: _asset_manager(client, publisher, health, settings, signal_engine),
                ))
            )
            scope = "ALL open assets (dynamic)"
        else:
            streamers = [
                CandleStreamer(client, publisher, health, asset,
                               settings.timeframes, settings.candle_history_size,
                               signal_engine=signal_engine)
                for asset in settings.assets
            ]
            stream_tasks += [
                asyncio.create_task(_supervised(f"candles:{s.asset}", s.run)) for s in streamers
            ]
            scope = f"{len(settings.assets)} assets"
        logger.info(
            "Feed service running (auth mode: %s): %s, timeframes %s",
            settings.auth_mode, scope, list(settings.timeframes),
        )

        # Run until a stop signal or the session expires mid-run (watchdog fires).
        expired_wait = asyncio.create_task(client._expired.wait())
        stop_wait = asyncio.create_task(stop.wait())
        await asyncio.wait({expired_wait, stop_wait}, return_when=asyncio.FIRST_COMPLETED)
        expired_wait.cancel()
        stop_wait.cancel()

        for t in stream_tasks:
            t.cancel()
        await asyncio.gather(*stream_tasks, return_exceptions=True)
        await client.close()

        if stop.is_set():
            break
        # Session expired mid-run — wait for a refresh, then loop to reconnect.
        settings = await _recover_session(settings, health, publisher, stop)

    logger.info("Shutting down…")
    for t in infra:
        t.cancel()
    await asyncio.gather(*infra, return_exceptions=True)
    await publisher.close()
    logger.info("Bye.")


async def run_check(settings: Settings) -> None:
    """Bounded end-to-end validation for setup/demo: config → Redis → login →
    catalog with payouts. Exits non-zero on the first failure."""
    print(f"1/4 Config ................ OK (auth mode: {settings.auth_mode})")

    publisher = RedisPublisher(settings.redis_url)
    try:
        await publisher.ping()
    except Exception as exc:
        print(f"2/4 Redis ................. FAIL ({exc})")
        print("    Start it with: docker compose up -d redis")
        raise SystemExit(1)
    print(f"2/4 Redis ................. OK ({settings.redis_url})")

    health = Health(settings.assets)
    client = QuotexFeedClient(settings, health)
    step3 = "Quotex session" if settings.auth_mode == "session" else "Quotex login"
    try:
        await client.connect(max_attempts=3)
    except ConnectionError as exc:
        print(f"3/4 {step3} ......... FAIL\n    {exc}")
        raise SystemExit(1)
    print(f"3/4 {step3} ......... OK (PRACTICE balance: {health.balance})")

    rows = await client.get_instruments()
    parsed = [p for p in (parse_instrument(r) for r in rows) if p]
    open_assets = [p for p in parsed if p["open"]]
    if not parsed:
        print("4/4 Asset catalog ......... FAIL (no instruments received)")
        await client.close()
        raise SystemExit(1)
    print(f"4/4 Asset catalog ......... OK ({len(parsed)} assets, {len(open_assets)} open)")

    sample = sorted(open_assets, key=lambda a: a["symbol"])[:8]
    for a in sample:
        print(f"      {a['symbol']:<16} {a['name']:<24} payout {a['payout']}%")

    await client.close()
    await publisher.close()
    print("\nAll checks passed — the Quotex API connection is working.")


def cli() -> None:
    parser = argparse.ArgumentParser(prog="quotex-feed", description=__doc__)
    parser.add_argument(
        "--check", action="store_true",
        help="validate config, Redis, Quotex login and asset catalog, then exit",
    )
    parser.add_argument(
        "--doctor", action="store_true",
        help="network diagnostic: will Quotex's realtime WebSocket work from "
             "this IP? Needs no Redis or credentials — run it on a candidate host.",
    )
    args = parser.parse_args()

    if args.doctor:
        # Doctor must run anywhere, even with an incomplete .env — load settings
        # leniently and never block on config problems.
        from .doctor import run_doctor
        settings = Settings.from_env()
        _setup_logging(settings.log_level)
        raise SystemExit(asyncio.run(run_doctor(settings)))

    settings = _load_settings_or_exit()
    _setup_logging(settings.log_level)

    try:
        asyncio.run(run_check(settings) if args.check else run_service(settings))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    cli()
