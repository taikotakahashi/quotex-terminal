# Phase 1 — Quotex Feed Service: Build Plan

> **Status (2026-09-03): ✅ WORKING END-TO-END.** Verified live on this machine:
> Quotex session (demo balance 10000), 92-asset catalog with real-time payouts
> and open/closed status, live ticks on all subscribed assets, and closed M1
> candles aggregated from ticks (e.g. EURUSD_otc M1 from 124 ticks). Health
> endpoint reports `ok`. Criteria **M1–M4 met.** 15 unit tests green.
>
> The WS HTTP-403 was **not** the IP (that earlier guess was wrong). Two real
> causes, both fixed in the vendored client: (1) Cloudflare's **JA3 TLS
> fingerprint** check on the WS upgrade — fixed by switching the transport to
> **curl_cffi** with Chrome impersonation; (2) **binary vs text** WS frames —
> curl_cffi defaults to BINARY but socket.io needs TEXT, so auth was silently
> dropped — fixed by forcing `CurlWsFlag.TEXT`. See DIAGNOSE_WS_403.md and
> vendor/pyquotex/VENDORED.md.
>
> **M5 DONE (2026-09-03):** live web dashboard for the customer — a React
> frontend + FastAPI backend reading Redis, showing the LIVE badge, demo balance,
> the full asset catalog with real-time payouts, and streaming candlestick
> charts. Verified with a headless-Chrome screenshot. Project is now split into
> `backend/` and `frontend/`. See DASHBOARD.md. `quotex-feed --doctor` also added.

The Feed Service is the component that connects to Quotex's unofficial WebSocket
API and makes its data available to the rest of the platform. This document
defines what "Quotex API setup complete" means as a verifiable, demo-able
milestone, and how we get there. See ARCHITECTURE.md §1 for how it fits the
overall system.

## Definition of done (acceptance criteria)

The API setup is complete when, running against a live Quotex demo account:

1. **Login & session** — the service authenticates (handling Cloudflare), stores
   the session, and stays connected for hours without manual intervention;
   an expired session re-authenticates automatically.
2. **Live asset catalog** — the full Quotex instruments list streams in real time:
   asset name, category, open/closed status, and current payout %, updating as
   Quotex changes them.
3. **Live candles** — tick data for selected assets (majors + one OTC pair) is
   received and aggregated into M1/M5/M15 candles that match Quotex's own chart.
4. **Resilience** — killing the connection (network drop, forced disconnect)
   results in automatic reconnect + resubscribe with no data corruption.
5. **Published output** — all of the above is published to Redis in the agreed
   message schema, consumable by any downstream service.

## Client demo layer (recommended)

Console logs make a poor demo for a non-technical client. A **thin read-only
status page** (single page, no auth) showing the live asset list with payout
badges, connection status/uptime, and a live-updating candle chart for one asset
makes the milestone visibly real and maps directly to acceptance criteria 1–5.
Small scope (~a day) since it only reads Redis; it later becomes the seed of the
public landing page. Can be dropped if a terminal demo suffices.

## Technical approach

- **Language/runtime**: Python 3.12, asyncio.
- **Protocol layer**: evaluate the current state of the open-source Quotex
  clients (the `pyquotex` family) at build time — these break and get patched
  frequently. Whichever wins, we **vendor/fork it into the repo** rather than
  pip-installing, so we can patch protocol changes ourselves within hours instead
  of waiting on a maintainer.
- **Auth**: email/password login against qxbroker, Cloudflare-aware client
  (correct TLS/user-agent fingerprint; browser-automation fallback if needed for
  the initial login), session cookies/token persisted to disk and reused.
- **Streams**: subscribe to the instruments channel (assets + payouts) and to
  tick/candle streams for a configurable asset list; aggregate ticks into
  M1/M5/M15 candles.
- **Output**: Redis pub/sub topics + rolling buffers:
  - `assets.snapshot` / `assets.update` — catalog with payout and open/closed.
  - `candles.<asset>.<timeframe>` — closed candles (OHLC, volume, timestamps).
  - `ticks.<asset>` — live price for the frontend price display.
  - `feed.health` — connection state, last-message age, session age.
- **Ops**: Dockerized; structured logs; health endpoint; exponential-backoff
  reconnect; alert hook (initially just a log/Telegram ping) when the feed is
  down > N seconds.

## Build milestones

| # | Milestone | Demonstrates |
|---|---|---|
| M1 | Login + persistent session (survives restarts, auto-refresh) | Criterion 1 |
| M2 | Live asset catalog with payouts streaming to Redis | Criterion 2 |
| M3 | Tick + candle streaming for selected assets, M1/M5/M15 aggregation verified against Quotex's chart | Criterion 3 |
| M4 | Reconnect/resubscribe hardening + health reporting | Criteria 4–5 |
| M5 | Status page for the client demo (optional but recommended) | The payment demo |

## Prerequisites (needed before coding starts)

1. **A dedicated Quotex account** — fresh email, demo balance only. Credentials
   will live in a local `.env` file (never committed, never pasted into chat);
   I'll scaffold the file with placeholders.
2. **Docker** available locally (for Redis). Everything runs on this machine
   first; VPS comes in Phase 2.
3. **Region check** — Quotex geo-blocks some countries. If the site isn't
   reachable from this machine's network, we'll need to decide on a VPN or a
   VPS in a permitted region *before* building, since the session is IP-sensitive.

## Setting client expectations (recommendation)

This integration rides an **unofficial, reverse-engineered API**. It will work,
and it will also occasionally break without warning when Quotex changes their
protocol — that's a property of the approach, not of the build quality. For a
client relationship, it's worth putting in writing that (a) delivery is judged
by the acceptance criteria above at demo time, and (b) ongoing protocol
maintenance is expected, separate work (retainer or per-incident), not a
warranty defect.
