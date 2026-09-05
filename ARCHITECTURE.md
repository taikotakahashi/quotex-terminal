# Quotex Signals Platform — Architecture

A public, freemium web platform that analyzes live Quotex market data and displays
buy/sell signals in the style of masterwinn.com/free — but backed by real data.
Signals-only: the platform never executes trades or touches client broker accounts.

## Agreed decisions

| Decision | Choice |
|---|---|
| Price/asset data source | Quotex unofficial WebSocket API (server-side demo account) |
| Trade execution | None — display signals only, clients trade manually on Quotex |
| Audience | Public website, free tier + paid premium tier |
| Asset list | Full live Quotex catalog (incl. OTC), real-time payout % per asset |
| Access model | Freemium teaser: public landing w/ live asset list + limited demo; free account unlocks full panel; paid plan unlocks premium assets/timeframes |
| Client area | Dashboard, profile, subscription, signal history, preferences, personal trade journal, notifications (Telegram/email/push), referral/affiliate module |

## Components

```
Quotex WS ──> [Feed Service] ──> Redis ──> [Signal Engine] ──> Postgres
                                   │              │
                                   └──────> [FastAPI backend] <── auth/billing
                                                  │  REST + WS
                                                  v
                                           [Next.js frontend]
                                                  │
                                    [Notification workers: Telegram/email/push]
```

### 1. Feed Service (Python, isolated)
- Logs into Quotex with a dedicated **demo account** (identical price feed, no real funds at risk), maintains the WebSocket session with auto-reconnect and session refresh.
- Subscribes to:
  - **Candle/tick streams** for supported assets; aggregates into M1/M5/M15 candles.
  - **Instruments channel**: full asset catalog with category, open/closed status, and live payout % (per expiry where available).
- Publishes everything into Redis (pub/sub + rolling buffers). **Nothing else in the
  system talks to Quotex directly** — protocol breakage is contained to this service,
  and the site degrades to "feed reconnecting" instead of going down.
- Health metrics + alerting when the feed drops or the protocol changes.

### 2. Signal Engine (Python)
- Consumes closed candles per asset/timeframe; maintains EMA 9/21, RSI 14, MACD,
  momentum.
- On candle close: decide signal/no-signal, direction, confidence score, scheduled
  entry time (next candle open).
- Payout-aware: records payout at signal time; can filter/rank by minimum payout
  (premium feature).
- After expiry: scores WIN/LOSS/DRAW against actual close, persists to Postgres.
  History is **real and unfiltered** — the public track record is the product's
  credibility.

### 3. Backend API (FastAPI)
- REST: auth, profile, subscription state, signal history, journal, referral stats.
- WebSocket/SSE fan-out: live prices, indicators, asset catalog + payouts, signals.
- Tier gating enforced server-side on both REST and the realtime channel.
- One Quotex session serves unlimited visitors; web tier scales independently.

### 4. Frontend (Next.js/React)
- Public landing: live asset list with payout badges, limited demo (1–2 pairs,
  delayed signals), track-record page, registration funnel.
- Signal panel (masterwinn format): asset selector grouped by category with live
  payout badge and closed-asset greying, M1/M5/M15 toggles, Start/Reset, indicator
  dashboard, upcoming-signal cards with countdowns, win/loss history table.
- Client area: profile, plan management, personal stats (win rate by
  asset/timeframe), favorites + min-payout preferences, trade journal (mark which
  signals were actually traded and the personal outcome), notification settings,
  referral links + commission tracking.

### 5. Storage
- **Postgres**: users, subscriptions, signals + outcomes, journal entries,
  referrals/commissions, notification preferences.
- **Redis**: live candle buffers, asset catalog snapshot, pub/sub between services.

### 6. Auth & Billing
- Email/password + Google OAuth; JWT sessions; authenticated WebSocket.
- **Payment rail is an open business decision**: Stripe/PayPal prohibit or restrict
  binary-options-related services. Realistic options: crypto payments or a
  high-risk processor. Research before Phase 3; nothing else blocks on it.

### 7. Notifications & Referrals
- Worker processes consuming signal events from Redis: Telegram bot, email
  (transactional provider), browser push. Sent per client preferences (favorite
  assets, min payout), gated by tier.
- Referral module: per-client codes/links, signup + conversion attribution,
  commission ledger.

## Tiering (initial proposal)

| | Public (no account) | Free account | Premium |
|---|---|---|---|
| Live asset list + payouts | ✅ | ✅ | ✅ |
| Signal panel | 1–2 pairs, delayed | Major pairs, M1 | All assets incl. OTC, all timeframes |
| Notifications | — | — | ✅ |
| Trade journal / stats | — | ✅ | ✅ |
| Min-payout filter | — | — | ✅ |

## Risks & mitigations
- **Quotex protocol changes / ToS**: unofficial API; contained in Feed Service
  behind the Redis boundary; demo account only; monitoring + fast patching.
- **Payments**: card processors hostile to this niche — see §6.
- **Legal**: binary options restricted/banned for retail in EU/UK/CA/US; signals
  may qualify as investment advice in some jurisdictions. Prominent "not financial
  advice, results not guaranteed" disclaimers; choose marketed regions carefully.
- **Signal quality honesty**: indicator stacks do not reliably predict short-expiry
  outcomes; the platform shows real performance rather than curated wins.

## Build phases
1. **Engine** — Feed Service + Signal Engine + single-user panel on real Quotex
   data (local dev). Proves the unofficial feed; history starts accumulating.
2. **Public freemium** — auth, client area essentials, trade journal, tier gating,
   VPS deploy (Docker), monitoring.
3. **Monetize & grow** — payment rail, premium gating, notifications, referral
   module.

## Stack
Python 3.12 (Feed Service, Signal Engine, FastAPI) · Redis · Postgres ·
Next.js/React · Docker on a VPS.
