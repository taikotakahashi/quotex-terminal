"""FastAPI app: REST + WebSocket over the feed's Redis data (+ local auth).

Run:  quotex-api           (or: uvicorn webapi.main:app --port 8000)
"""
from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .auth import router as auth_router
from .auth import admin_router
from .auth.config import load_auth_settings
from .auth.db import init_db
from .auth.deps import get_optional_user, require_verified_user
from .auth.models import User
from .gateway import RedisGateway
from .telegram_routes import router as telegram_router

logger = logging.getLogger("webapi")

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")


def _load_backend_dotenv() -> None:
    """Load backend/.env so `make api` picks up DATABASE_URL / SMTP_* without exporting."""
    candidates = [
        Path(__file__).resolve().parents[2] / ".env",  # backend/.env
        Path.cwd() / ".env",
        Path.cwd() / "backend" / ".env",
    ]
    for env in candidates:
        if not env.exists():
            continue
        for line in env.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            k = k.strip()
            v = v.strip()
            if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
                v = v[1:-1]
            # Always apply file values for local auth keys so restarts pick up edits.
            if k.startswith(
                (
                    "DATABASE_",
                    "SESSION_",
                    "COOKIE_",
                    "CSRF_",
                    "APP_",
                    "EMAIL_",
                    "SMTP_",
                    "AUTH_",
                    "VERIFY_",
                    "RESET_",
                    "WEBAPI_",
                    "TELEGRAM_",
                )
            ):
                os.environ[k] = v
            else:
                os.environ.setdefault(k, v)
        break


_load_backend_dotenv()
_auth = load_auth_settings()
CORS_ORIGINS = _auth.cors_origins


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        await init_db()
        logger.info("Auth database ready")
    except Exception:
        logger.exception("Auth DB init failed — /api/auth will error until Postgres is up")

    gw = RedisGateway(REDIS_URL)
    try:
        await gw.ping()
        logger.info("Connected to Redis at %s", REDIS_URL)
    except Exception:
        logger.warning("Redis not reachable at %s yet — endpoints will report offline", REDIS_URL)
    app.state.gw = gw
    yield
    await gw.close()


app = FastAPI(title="Quotex Feed API", version="0.2.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS if CORS_ORIGINS != ["*"] else ["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)
app.include_router(auth_router)
app.include_router(admin_router)
app.include_router(telegram_router)

_uploads_dir = Path(__file__).resolve().parents[2] / "uploads"
_uploads_dir.mkdir(parents=True, exist_ok=True)
(_uploads_dir / "avatars").mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(_uploads_dir)), name="uploads")


def _maybe_gate():
    """When AUTH_REQUIRED=true, market data needs a verified session."""
    if _auth.auth_required:
        return Depends(require_verified_user)
    return Depends(get_optional_user)


_gate = _maybe_gate()


@app.get("/api/health")
async def health():
    return await app.state.gw.get_health()


@app.get("/api/status")
async def status(_user: User | None = _gate):
    """Compact summary for the dashboard header."""
    h = await app.state.gw.get_health()
    assets = await app.state.gw.get_assets()
    open_count = sum(1 for a in assets["assets"] if a.get("open"))
    return {
        "feed_status": h.get("status", "offline"),
        "connected": h.get("connected", False),
        "account_mode": h.get("account_mode"),
        "uptime_sec": h.get("uptime_sec"),
        "asset_count": assets.get("count", 0),
        "open_count": open_count,
        "instruments_age_sec": h.get("instruments_age_sec"),
    }


@app.get("/api/assets")
async def assets(
    open_only: bool = Query(False),
    category: str | None = Query(None),
    min_payout: float | None = Query(None, ge=0, le=100),
    _user: User | None = _gate,
):
    return await app.state.gw.get_assets(open_only, category, min_payout)


@app.get("/api/candles/{asset}/{timeframe}")
async def candles(
    asset: str,
    timeframe: int,
    limit: int = Query(120, ge=1, le=500),
    _user: User | None = _gate,
):
    if timeframe not in (60, 300, 900):
        raise HTTPException(400, "timeframe must be 60, 300 or 900")
    return {
        "asset": asset,
        "timeframe": timeframe,
        "candles": await app.state.gw.get_candles(asset, timeframe, limit),
    }


@app.get("/api/tick/{asset}")
async def tick(asset: str, _user: User | None = _gate):
    t = await app.state.gw.get_tick(asset)
    if t is None:
        raise HTTPException(404, "no tick for asset")
    return t


@app.get("/api/signal/{asset}/{timeframe}")
async def signal(
    asset: str,
    timeframe: int,
    history: int = Query(12, ge=1, le=50),
    _user: User | None = _gate,
):
    if timeframe not in (60, 300, 900):
        raise HTTPException(400, "timeframe must be 60, 300 or 900")
    return {
        "asset": asset,
        "timeframe": timeframe,
        "signal": await app.state.gw.get_signal(asset, timeframe),
        "history": await app.state.gw.get_signal_history(asset, timeframe, history),
        "indicators": await app.state.gw.get_indicators(asset, timeframe),
    }


@app.get("/api/signals/active")
async def active_signals(_user: User | None = _gate):
    """Live (not yet expired) signals across all assets/timeframes."""
    signals = await app.state.gw.list_active_signals()
    return {"count": len(signals), "signals": signals}


@app.get("/api/signals/history")
async def signals_history(
    timeframe: int = Query(..., description="Operation time in seconds"),
    limit: int = Query(20, ge=1, le=50),
    _user: User | None = _gate,
):
    """Recent scored signals for the chosen operation time, all assets."""
    if timeframe not in (60, 300, 900):
        raise HTTPException(400, "timeframe must be 60, 300 or 900")
    history = await app.state.gw.get_recent_signal_history(timeframe, limit)
    return {"timeframe": timeframe, "history": history}


@app.get("/api/indicators/{asset}/{timeframe}")
async def indicators(asset: str, timeframe: int, _user: User | None = _gate):
    if timeframe not in (60, 300, 900):
        raise HTTPException(400, "timeframe must be 60, 300 or 900")
    data = await app.state.gw.get_indicators(asset, timeframe)
    return {"asset": asset, "timeframe": timeframe, "indicators": data}


@app.websocket("/ws")
async def ws(websocket: WebSocket):
    """Push every live feed event (health, assets_update, tick, candle)."""
    # Accept first — closing before accept breaks Vite's WS proxy (EPIPE).
    await websocket.accept()

    auth_cookie: str | None = None
    if _auth.auth_required:
        from .auth.db import SessionLocal
        from .auth.security import hash_token
        from .auth.models import Session as AuthSession
        from sqlalchemy import select
        from sqlalchemy.orm import selectinload
        from datetime import datetime, timezone

        async def _session_still_valid(raw: str) -> bool:
            async with SessionLocal() as db:
                result = await db.execute(
                    select(AuthSession)
                    .where(AuthSession.token_hash == hash_token(raw))
                    .options(selectinload(AuthSession.user))
                )
                sess = result.scalar_one_or_none()
                now = datetime.now(timezone.utc)
                if (
                    sess is None
                    or sess.revoked_at is not None
                    or sess.user is None
                    or not sess.user.is_active
                    or sess.user.email_verified_at is None
                ):
                    return False
                exp = (
                    sess.expires_at
                    if sess.expires_at.tzinfo
                    else sess.expires_at.replace(tzinfo=timezone.utc)
                )
                return exp >= now

        auth_cookie = websocket.cookies.get(_auth.cookie_name)
        ok = bool(auth_cookie) and await _session_still_valid(auth_cookie)
        if not ok:
            await websocket.close(code=4403 if auth_cookie else 4401)
            return

    gateway = websocket.app.state.gw

    try:
        await websocket.send_json({"type": "health", "data": await gateway.get_health()})
    except Exception:
        pass

    async def pump():
        async for event in gateway.events():
            await websocket.send_json(event)

    pump_task = asyncio.create_task(pump())
    try:
        while True:
            # Re-check auth periodically so disable/delete logs the user out of /ws too.
            if _auth.auth_required and auth_cookie:
                try:
                    await asyncio.wait_for(websocket.receive_text(), timeout=20.0)
                except asyncio.TimeoutError:
                    if not await _session_still_valid(auth_cookie):
                        await websocket.close(code=4403)
                        break
                    continue
            else:
                await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        pump_task.cancel()
        try:
            await pump_task
        except (asyncio.CancelledError, Exception):
            pass


def cli() -> None:
    import uvicorn

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    uvicorn.run(
        "webapi.main:app",
        host=os.getenv("WEBAPI_HOST", "0.0.0.0"),
        port=int(os.getenv("WEBAPI_PORT", "8000")),
        log_level="info",
    )


if __name__ == "__main__":
    cli()
