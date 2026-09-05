# Running the feed on a residential IP

> **NOTE (2026-09-03): This is no longer required.** The WS 403 turned out to be
> a TLS-fingerprint issue, not the IP — it's fixed in code (curl_cffi
> impersonation) and the feed works from the current machine. This doc is kept
> as a generic "run on another machine" guide and as background. See
> DIAGNOSE_WS_403.md for the real cause and fix.

The service runs from any machine with normal Quotex access. Do this on your
home PC (Windows/macOS/Linux) if you want it off the current host.

The key rule: **capture the browser session on the SAME machine that runs the
feed**, so the `cf_clearance` cookie and the feed share one residential IP.

## Steps (on your home machine)

1. **Get the code + Python 3.12+**
   ```bash
   # copy this repo to the home machine (git clone, scp, zip — whatever’s easy)
   cd Quotex
   python3 -m venv .venv
   .venv/bin/pip install -e ./vendor/pyquotex -e "./feed_service[test]"
   #   Windows PowerShell: .venv\Scripts\pip install -e ...
   ```

2. **Fast pre-check — will this IP even work?** (needs no .env, no Redis)
   ```bash
   .venv/bin/quotex-feed --doctor
   ```
   - `VERDICT: ✅ This IP works` → continue.
   - `VERDICT: ❌ ... blocking the WebSocket` → this machine is also on a
     datacenter/VPN IP; use a truly residential connection (turn off VPN) or a
     residential proxy.

3. **Start Redis**
   ```bash
   docker compose up -d redis         # or run a local redis any way you like
   ```

4. **Capture the browser session ON THIS MACHINE** — open Chrome/Edge here, log
   into your Quotex **demo** account, confirm live charts move, then grab the
   three values per DIAGNOSE_WS_403.md and put them in `.env`:
   ```
   QX_SSID=<session hash from the WS "authorization" frame>
   QX_COOKIES=<full cookie header incl. cf_clearance>
   QX_USER_AGENT=<navigator.userAgent, starts with Mozilla/>
   FEED_ASSETS=EURUSD,GBPUSD,EURUSD_otc
   FEED_TIMEFRAMES=60,300,900
   ```
   (The config now auto-extracts the SSID if you paste the whole
   `42["authorization",{...}]` frame, and warns if SSID/UA get swapped.)

5. **Verify end-to-end**
   ```bash
   .venv/bin/quotex-feed --check
   ```
   Expect: config OK → Redis OK → Quotex session OK (with demo balance) → asset
   catalog with live payouts.

6. **Run it**
   ```bash
   .venv/bin/quotex-feed
   ```
   Then watch the data:
   ```bash
   redis-cli get feed:assets | python3 -m json.tool          # catalog + payouts
   redis-cli subscribe feed.candles.EURUSD.60                # live M1 candles
   curl -s localhost:8010 | python3 -m json.tool             # health
   ```

## When you're ready for production

Decide hosting later (you marked it undecided). To keep a VPS in production,
we'll add a **residential proxy** routed through the WebSocket (`QX_PROXY` plus a
small patch to the vendored client) and capture `cf_clearance` through that proxy
IP. Ask when you want that built.
