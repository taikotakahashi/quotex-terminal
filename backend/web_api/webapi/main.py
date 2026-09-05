"""FastAPI app: REST + WebSocket over the feed's Redis data.

Run:  quotex-api           (or: uvicorn webapi.main:app --port 8000)
"""
from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .gateway import RedisGateway

logger = logging.getLogger("webapi")

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
# Comma-separated allowed origins; "*" allows any (fine for this read-only,
# public-market-data dashboard).
CORS_ORIGINS = [o.strip() for o in os.getenv("WEBAPI_CORS", "*").split(",") if o.strip()]


@asynccontextmanager
async def lifespan(app: FastAPI):
    gw = RedisGateway(REDIS_URL)
    try:
        await gw.ping()
        logger.info("Connected to Redis at %s", REDIS_URL)
    except Exception:
        logger.warning("Redis not reachable at %s yet — endpoints will report offline", REDIS_URL)
    app.state.gw = gw
    yield
    await gw.close()


app = FastAPI(title="Quotex Feed API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["GET"],
    allow_headers=["*"],
)


def gw(app: FastAPI = None) -> RedisGateway:  # small helper for handlers
    return app.state.gw


@app.get("/api/health")
async def health():
    return await app.state.gw.get_health()


@app.get("/api/status")
async def status():
    """Compact summary for the dashboard header."""
    h = await app.state.gw.get_health()
    assets = await app.state.gw.get_assets()
    open_count = sum(1 for a in assets["assets"] if a.get("open"))
    # Balance is intentionally NOT exposed — the dashboard is viewed by many users.
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
):
    return await app.state.gw.get_assets(open_only, category, min_payout)


@app.get("/api/candles/{asset}/{timeframe}")
async def candles(asset: str, timeframe: int, limit: int = Query(120, ge=1, le=500)):
    if timeframe not in (60, 300, 900):
        raise HTTPException(400, "timeframe must be 60, 300 or 900")
    return {
        "asset": asset,
        "timeframe": timeframe,
        "candles": await app.state.gw.get_candles(asset, timeframe, limit),
    }


@app.get("/api/tick/{asset}")
async def tick(asset: str):
    t = await app.state.gw.get_tick(asset)
    if t is None:
        raise HTTPException(404, "no tick for asset")
    return t


@app.get("/api/signal/{asset}/{timeframe}")
async def signal(asset: str, timeframe: int, history: int = Query(12, ge=1, le=50)):
    if timeframe not in (60, 300, 900):
        raise HTTPException(400, "timeframe must be 60, 300 or 900")
    return {
        "asset": asset,
        "timeframe": timeframe,
        "signal": await app.state.gw.get_signal(asset, timeframe),
        "history": await app.state.gw.get_signal_history(asset, timeframe, history),
    }


@app.websocket("/ws")
async def ws(websocket: WebSocket):
    """Push every live feed event (health, assets_update, tick, candle)."""
    await websocket.accept()
    gateway = websocket.app.state.gw

    # Send an immediate snapshot so the client can render before the first tick.
    try:
        await websocket.send_json({"type": "health", "data": await gateway.get_health()})
    except Exception:
        pass

    async def pump():
        async for event in gateway.events():
            await websocket.send_json(event)

    pump_task = asyncio.create_task(pump())
    try:
        # Keep the receive side alive (also drains client pings/messages).
        while True:
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
