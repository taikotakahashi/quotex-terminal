# Quotex Signals Platform

A freemium web platform that analyzes live Quotex market data and displays
buy/sell signals. **Signals only — it never executes trades.**

- [ARCHITECTURE.md](ARCHITECTURE.md) — full system design and agreed decisions
- [PHASE1_FEED_SERVICE.md](PHASE1_FEED_SERVICE.md) — current phase: the Quotex
  API feed service, with acceptance criteria

## Repository layout

```
backend/
  vendor/pyquotex/    vendored + patched unofficial Quotex client (see VENDORED.md)
  feed_service/       streams assets/payouts/ticks/candles into Redis (Phase 1)
  web_api/            FastAPI: reads Redis, serves REST + WebSocket
  .env                Quotex session config (gitignored)
frontend/             Vite + React + TS live dashboard
docker-compose.yml    local Redis
Makefile              dev commands (make help)
```

Data flows one way: `Quotex → feed_service → Redis → web_api → frontend`. Nothing
downstream of the feed talks to Quotex directly; the web API and dashboard are
read-only.

## Quickstart

```bash
# 1. One-time setup (Python venv + backend packages + frontend deps)
make install
cp backend/.env.example backend/.env    # fill in your Quotex session (see below)

# 2. Start Redis
make redis

# 3. Verify the Quotex connection end-to-end
make check

# 4. Run the stack (separate terminals or backgrounded)
make feed      # Quotex -> Redis
make api       # web API on http://localhost:8000
make web       # dashboard on http://localhost:5173
```

Open **http://localhost:5173** for the live dashboard — see [DASHBOARD.md](DASHBOARD.md).

The feed authenticates with a browser-captured session (Session mode). If the
WebSocket ever fails, `make doctor` diagnoses it; details in
[DIAGNOSE_WS_403.md](DIAGNOSE_WS_403.md).

### Authentication: Session mode vs Login mode

Quotex sits behind Cloudflare, which enforces a browser **TLS-fingerprint (JA3)**
check on the realtime WebSocket. The client handles this by connecting through
**curl_cffi** with Chrome impersonation (`QX_IMPERSONATE`, default `chrome`) —
see [DIAGNOSE_WS_403.md](DIAGNOSE_WS_403.md) for the full story. Two auth modes:

- **Session mode (recommended):** a session captured from a browser logged into
  Quotex (`QX_SSID`, `QX_COOKIES`, `QX_USER_AGENT`). These tokens **expire**; when
  the feed says the session is expired, refresh them with **`make capture`** (opens
  a browser to log in and rewrites `backend/.env`), or capture manually per
  DIAGNOSE_WS_403.md.
- **Login mode (fallback):** `QUOTEX_EMAIL` / `QUOTEX_PASSWORD` — prompts for an
  email PIN. Currently unreliable headlessly; prefer Session mode + `make capture`.

While running, inspect the data directly:

- `docker exec quotex-redis redis-cli get feed:assets` — catalog with payouts
- `docker exec quotex-redis redis-cli subscribe feed.candles.EURUSD_otc.60` — closed M1 candles
- `curl -s localhost:8000/api/status` — API view of feed health
- `curl -s localhost:8010` — the feed's own health endpoint

(There is no `redis-cli` on the host PATH; use it via the container as shown.)

Unit tests: `make test`

## Security notes

- Credentials/session live only in `backend/.env` (gitignored). Use a
  **dedicated demo account** — the feed never trades and never needs real funds.
- `session.json`, `settings/`, `browser/` are Quotex session artifacts created in
  the working directory; gitignored, contain auth material — do not share them.
- The web API and dashboard are **read-only** — they read Redis and never write
  or place trades.
