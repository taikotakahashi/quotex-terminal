# Live Dashboard — customer verification

A read-only web dashboard that proves the Quotex integration is real and live.
It's the visible counterpart to `quotex-feed --check`, meant for showing the
customer.

## What it shows

- **Connection banner** — a pulsing **LIVE** badge, the demo account balance,
  feed uptime, open/total asset counts, and how fresh the catalog is. If the
  feed stops, the banner flips to OFFLINE within ~20s.
- **Assets & live payouts** — the full Quotex catalog, searchable and filterable
  (by type, open-only, and a minimum-payout slider), each row showing the
  asset, live price, **real-time payout %**, and open/closed status. Payouts and
  prices update live. *(This is the customer's core requirement.)*
- **Live candle chart** — click any asset to see its candlestick chart with
  M1/M5/M15 toggles; the current candle forms in real time from the tick stream,
  and closed candles come straight from the feed.

- **Signal engine (the product).** For each asset/timeframe the backend computes
  EMA 9/21, RSI 14, MACD and momentum on every closed candle and emits a
  **CALL/PUT** signal with a confidence % and plain-English reasons, scheduled at
  the next candle. When that candle closes it's scored **WIN/LOSS/DRAW** against
  the real entry/exit price. The dashboard shows the live signal card, the
  indicators, and the honest win/loss history. Endpoints: `GET
  /api/signal/{asset}/{tf}` and the `signal` / `signal_result` WS events.

Confidence comes from indicator agreement — it is **not** a guarantee (short
expiries are near-random); the value is that the win/loss record is real and
unfiltered.

## Architecture (backend / frontend split)

```
frontend/  Vite + React + TypeScript dashboard (port 5173)
              │  REST (initial load) + WebSocket (live updates)
              v
backend/
  web_api/   FastAPI — reads Redis, serves REST + WS      (port 8000)
  feed_service/  Quotex feed -> Redis                     (see PHASE1)
  vendor/pyquotex/  patched Quotex client
Redis        the boundary between them                    (port 6379)
```

The frontend never talks to Quotex or Redis directly — only to the web API. The
web API is read-only (reads Redis, never writes, never trades).

## Run it

```bash
make install        # one-time: venv + backend packages + npm install
make redis          # start Redis

# three processes (separate terminals, or backgrounded):
make feed           # streams Quotex -> Redis   (needs backend/.env configured)
make api            # web API on :8000
make web            # dashboard on :5173
```

Open **http://localhost:5173**. To show the customer from another machine on the
LAN, open `http://<this-machine-ip>:5173` — the dashboard auto-targets the API
on the same host, and the API listens on all interfaces with open CORS.

### Endpoints (for reference / integration)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/status` | header summary (connection, balance, counts) |
| GET | `/api/assets?open_only=&category=&min_payout=` | catalog + payouts |
| GET | `/api/candles/{asset}/{tf}?limit=` | recent candles (tf = 60/300/900) |
| GET | `/api/tick/{asset}` | latest price |
| WS  | `/ws` | live stream: health, tick, candle, assets_update |

## Notes

- The dashboard reflects whatever the feed publishes; if `make feed` isn't
  running, the banner shows OFFLINE and tables stay empty — that itself is a
  useful honesty check.
- Production build: `cd frontend && npm run build` → static files in
  `frontend/dist/` for hosting behind any web server.
