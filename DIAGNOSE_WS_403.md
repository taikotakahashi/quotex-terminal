# WebSocket 403 — diagnosis & fix

## ✅ SOLVED (2026-09-03) — it was TLS fingerprint + frame opcode, NOT the IP

The feed now connects end-to-end from this machine (demo balance, 92-asset
catalog with payouts, live candles). Two real causes were found and fixed:

1. **Cloudflare JA3 (TLS fingerprint) block on the WS upgrade.** The Python
   `websockets` library's TLS ClientHello is not browser-like, and Cloudflare
   enforces a JA3 check specifically on the WebSocket upgrade to
   `ws2.qxbroker.com` (plain HTTPS/polling is unaffected — which is why polling
   returned 200 while the upgrade returned a Cloudflare block page). **Fix:** the
   vendored client now uses **curl_cffi** with `impersonate="chrome"`, which
   presents a real Chrome TLS fingerprint. Verified: from the same IP,
   `websockets` gets 403 and curl_cffi connects.
2. **Binary vs text WebSocket frames.** After the socket opened, the SSID
   authorization got no response. `curl_cffi.send()` defaults to a **BINARY**
   opcode, but socket.io frames must be **TEXT** — Quotex silently dropped every
   frame we sent. **Fix:** the client forces `CurlWsFlag.TEXT`. Verified:
   authorization then returns `s_authorization` + the demo balance.

An earlier hypothesis in this file blamed the datacenter IP. **That was wrong.**
The IP (`185.164.35.17`, a hosting/proxy IP) is fine for the WS once the TLS
fingerprint looks like a browser — no residential IP or proxy is required.

Tunable: `QX_IMPERSONATE` (default `chrome`) picks the curl_cffi impersonation
target. `quotex-feed --doctor` reports IP + polling/WS reachability on any host.

---

## Account throttled ("session_refused" / silent `41` disconnect)

Symptom: the WebSocket connects and the handshake completes, then Quotex sends
`41` (disconnect) and drops it — no `authorization/reject`, no 403. A **real
browser is refused the same way**. This is Quotex's anti-abuse throttle on the
**account/IP**, triggered by too many connections/logins in a short time. It is
temporary but can last from minutes to many hours if repeatedly re-triggered.

**How to prevent it (behaviour matters most):**

1. **Don't hammer it.** Every `make check`, `make capture`, and feed restart is a
   fresh connection/auth. Running them repeatedly *keeps the block alive*. When
   throttled, stop and wait — don't retry every minute.
2. **Run the feed once and leave it up.** One long-lived connection is fine; many
   short-lived ones trigger the throttle. Avoid restart loops.
3. **Re-capture only when actually expired.** A captured session lasts hours;
   each `make capture` is a browser login. Don't capture pre-emptively.
4. **Use a throwaway demo account for development.** Keep the churn (checks,
   captures, restarts) on a disposable account; keep a separate clean account for
   the client demo. Demo accounts are free — rotate them.
5. **Keep `FEED_ASSETS` modest while testing** (a few pairs, not `ALL_OPEN`).
6. **If throttled for hours**, the account/IP may be flagged longer — a fresh
   demo account (new email) and/or a residential IP confirms and resets it.

The feed now handles this itself: on a throttle it enters a **quiet cooldown**
(`QX_THROTTLE_COOLDOWN`, default 20 min) with status `throttled`, then retries
once — so you can leave `make feed` running and it resumes on its own without
making the block worse. Do NOT sit there running `make check` during the wait.

**The feed also self-limits its own churn now (so it stops *causing* throttles):**
- a global floor of one connection attempt per ~25s across all reconnect paths;
- gentle WS auto-reconnect (15s→180s backoff instead of the old 1s hammering);
- new asset subscriptions are paced (spread out, not a burst of dozens).

These prevent the reconnect-storm / subscription-burst that trips the anti-abuse.
But note: an **already-flagged** account still needs a fresh account or a long
untouched wait to reset — the gentle behaviour prevents *re-*flagging, it can't
un-flag what's already blocked. Keeping `FEED_ASSETS` small also helps.

## Sessions expire — how to refresh (the common recurring issue)

A captured `QX_SSID` is a Quotex session token with a limited lifetime. When it
expires (after some hours, when the browser session ends, or when the account
logs in elsewhere), the WebSocket still connects but Quotex answers the
authorization with `42["authorization/reject"]`. The feed reports:

> Quotex rejected the session authorization — your QX_SSID has EXPIRED …

This is **not** the 403/transport problem — it just needs a fresh session.

**The feed self-heals.** As a service (`make feed`), it no longer crashes on
expiry: it stays running, publishes `status: session_expired` (the dashboard
shows a "reconnecting" banner), and **watches `backend/.env`**. The moment you
run `make capture` (which rewrites the session), the feed detects the new
`QX_SSID` and reconnects automatically — no need to restart `make feed` / `make
api` / `make web`. (`quotex-feed --check` still fails fast, by design.)

### Hands-free — `QX_AUTO_REFRESH=true` (recommended)

Run `make capture` **once** to log in (this saves an authenticated Chrome
profile in `backend/.chrome-capture/`). Then set `QX_AUTO_REFRESH=true` in
`backend/.env`. From then on, whenever the session expires the backend silently
re-drives that logged-in profile **on an invisible virtual display (Xvfb)** to
mint a fresh session and reconnects — no OTP, no window, no manual step. Verified
to complete in ~10s. It keeps working until the browser's "remember me" login
lapses (typically weeks); if that happens it falls back to asking for a one-time
`make capture`. Requires `pip install playwright` and a desktop/Xvfb (not a
purely headless server).

### Manual / first-time — `make capture`

```bash
make capture
```

Opens a **normal** Chrome window (launched as a plain subprocess, *not* an
automation-driven browser) so Cloudflare's "verify you are human" challenge
passes just like it does when you browse normally. The tool only *attaches* over
the DevTools protocol to read the session — it never drives the browser, so
there's no `navigator.webdriver` flag for Cloudflare to catch. (An
automation-launched browser, e.g. plain Playwright/Selenium, gets stuck on the
"Verifying…" page — that's why this approach is needed.)

Log into your Quotex **demo** account and open a chart; the tool captures the
fresh `QX_SSID` / `QX_COOKIES` / `QX_USER_AGENT` (including the WS authorization
frame and the HttpOnly `cf_clearance`) and writes them into `backend/.env`
(previous version backed up to `backend/.env.bak`). It reuses a persistent
Chrome profile (`backend/.chrome-capture/`) so after the first login, later
refreshes skip the challenge and often the OTP. Then `make check` and
`make feed`. Requires a desktop session and the system Chrome.

### Manual refresh

Follow the DevTools capture steps below and paste the three values into
`backend/.env` yourself.

---

## Original context (session capture)


## What the log means

- ✅ HTTP login + email OTP succeeded — credentials are valid, Cloudflare's HTTP
  checks passed.
- ❌ The realtime WebSocket handshake to `wss://ws2.qxbroker.com/socket.io/...`
  is rejected with **HTTP 403** before it opens.

Root cause: Cloudflare requires a **`cf_clearance`** cookie (bound to your exact
User-Agent + IP) to accept the WebSocket upgrade on the `ws2` subdomain. The
automated login only obtained `__cf_bm` / `_cfuvid` (confirmed in the saved
session), never `cf_clearance`, so the realtime endpoint blocks it.

## 30-second test: is it the cookies, or your IP?

Open **a normal desktop browser on this same machine**, go to qxbroker.com, log
into the same demo account, and open a chart.

- **You see live candlesticks moving** → your IP is fine. This is the
  cookie/fingerprint case → use **Session mode** below. This is the common case.
- **The chart never loads / stays blank / errors** → Cloudflare is blocking the
  WebSocket at the **network/IP** level (typical on VPS / datacenter / some VPN
  IPs). No cookie trick fixes this — you need to run the feed from a
  **residential IP** or route it through a residential proxy (`QX_PROXY` in
  `.env`). Then Session mode.

## Session mode (the fix): inject a real browser session

Instead of the automated login, we hand the feed a session captured from a
browser that has already cleared Cloudflare. This also removes the email-OTP
prompt on every start.

Capture three things from a browser logged into your Quotex **demo** account
(Chrome/Edge/Firefox DevTools — no extra software needed):

1. **User-Agent** — DevTools → Console → run:
   ```js
   navigator.userAgent
   ```

2. **Cookies** (must include `cf_clearance`) — DevTools → Application (Firefox:
   Storage) → Cookies → `https://qxbroker.com` → select all rows and build one
   string of `name=value` pairs separated by `; `. The essential ones:
   `cf_clearance`, `__cf_bm`, `_cfuvid`, `laravel_session`, and the long
   `remember_web_*` cookie. Easiest: DevTools → Network → click any request to
   qxbroker.com → Headers → copy the whole **`cookie:`** request header value.

3. **SSID** — DevTools → Network → filter **WS** → click the `socket.io`
   connection → Messages → find the first frame the browser **sends** that looks
   like:
   ```
   42["authorization",{"session":"<LONG_HASH>","isDemo":1,"tournamentId":0}]
   ```
   Copy `<LONG_HASH>` — that is the SSID.

Put them in `.env`:

```
QX_SSID=<LONG_HASH>
QX_COOKIES=cf_clearance=...; __cf_bm=...; _cfuvid=...; laravel_session=...; remember_web_...=...
QX_USER_AGENT=<exact navigator.userAgent string>
# optional, only if the IP test above failed:
# QX_PROXY=http://user:pass@residential-proxy-host:port
```

Then:

```bash
.venv/bin/quotex-feed --check
```

When `QX_SSID` is set the feed uses Session mode, skips the automated login and
OTP, and connects the WebSocket with the browser's cleared cookies.

### Session lifetime

`cf_clearance` is relatively short-lived and IP/UA-bound; the Quotex `session`
(SSID) lasts much longer. Once the WebSocket is open it stays connected. If a
reconnect later fails with 403 again, re-capture the cookies (SSID usually still
valid). A Playwright-based auto-capture helper can be added later to make this a
one-command refresh — ask if you want it.
