# Deployment — Frontend on Vercel, Backend on a VPS

```
Vercel (static)                     VPS (Ubuntu)
┌───────────────┐   HTTPS/WSS   ┌──────────────────────────────────────┐
│ frontend/     │ ────────────▶ │ Caddy (TLS)  →  quotex-api  :8000     │
│  (Vite build) │               │                    │ reads           │
└───────────────┘               │                 Redis  ◀─ quotex-feed │
   VITE_API_BASE=               │                          (Quotex WS + │
   https://api.yourdomain.com   │                           signals)    │
                                └──────────────────────────────────────┘
```

The frontend is static and talks only to the API over HTTPS + WSS. The API and
feed run on the VPS with Redis between them. **The API must be HTTPS** — Vercel
serves the page over HTTPS, and browsers block an HTTPS page from calling an
`http://`/`ws://` API (mixed content). Caddy gives you automatic HTTPS.

Two topologies are documented here:
- **Everything on one VPS** (frontend + backend together) — simpler, one domain,
  no CORS. See the section right below.
- **Frontend on Vercel, backend on a VPS** — sections 1–4 further down.

---

## Everything on one VPS (frontend + backend together)

```
                    VPS (Ubuntu)
┌───────────────────────────────────────────────────────┐
│ Caddy (TLS, one domain)                                │
│   /            -> frontend/dist   (static dashboard)   │
│   /api/*, /ws  -> quotex-api :8000 -> Redis <- quotex-feed │
└───────────────────────────────────────────────────────┘
```

Do the backend steps **1a–1d** below (system packages, install, session,
services) — they're identical. Then, instead of Vercel + the api-only Caddyfile,
do this:

### S1. Build the frontend on the VPS

Node is needed for the build. (Or build locally and `rsync frontend/dist/` up.)

```bash
# install Node 20 (once):
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

cd /opt/quotex/frontend
# same-origin: the app calls the API on the same domain it's served from
echo "VITE_API_BASE=https://yourdomain.com" > .env.production
npm ci            # or: npm install
npm run build     # -> /opt/quotex/frontend/dist
```

`VITE_API_BASE` is baked in at build time. Point it at your domain (no `:8000`,
no `/api` suffix) — Caddy routes `/api` and `/ws` to the backend.

### S2. Caddy — serve the SPA + proxy the API/WS on one domain

Point a DNS `A` record `yourdomain.com` → your VPS IP, then:

```bash
sudo apt install -y caddy
sudo cp deploy/Caddyfile.single-vps /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile          # replace yourdomain.com + the dist path
sudo systemctl reload caddy             # auto-fetches a Let's Encrypt cert
```

That's it — open `https://yourdomain.com`.

- No `WEBAPI_CORS` needed (same origin). Leave the api service default, or set
  `Environment=WEBAPI_CORS=https://yourdomain.com`.
- Rebuild the frontend after a `git pull` (`npm run build`); restart the backend
  with `sudo systemctl restart quotex-feed quotex-api`.

The rest of this file (sections 1a–1e, notes) applies; skip section 2 (Vercel).

---

## 0. Switching the Quotex account (do this first if changing accounts)

The account is your saved browser login + the session in `backend/.env`. To
switch:

```bash
make logout      # clears backend/.chrome-capture + the QX_SSID/COOKIES/UA in .env
# optionally update QUOTEX_EMAIL / QUOTEX_PASSWORD in backend/.env
make capture     # a browser opens on the Quotex LOGIN page → log into the NEW account
make check       # verify (run it ONCE)
```

`make logout` only clears the session/login — it leaves all other config intact.

> Tip: keep a **throwaway** demo account for development churn and a **clean**
> account for the client-facing deployment, so testing never throttles the demo
> account (see DIAGNOSE_WS_403.md → "Account throttled").

---

## 1. Backend on the VPS

Ubuntu 22.04/24.04 assumed. Run as a non-root `quotex` user; install to
`/opt/quotex`.

### 1a. System packages

```bash
sudo apt update
sudo apt install -y python3-venv python3-pip redis-server xvfb \
     wget gnupg ca-certificates
# Google Chrome (needed for session auto-refresh):
wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
sudo apt install -y ./google-chrome-stable_current_amd64.deb
sudo systemctl enable --now redis-server
```

### 1b. Get the code + install

```bash
sudo useradd -m -d /opt/quotex quotex        # or reuse an existing user
sudo -u quotex -H bash
cd /opt/quotex
git clone <your repo> .                       # or rsync the project here
make install                                   # venv + backend pkgs + frontend deps
```

### 1c. The Quotex session (the tricky part on a headless VPS)

The very first login needs a **visible browser + your email OTP**, which a
headless VPS can't show. Two options:

- **Recommended — capture locally, copy the profile up.** On a machine with a
  desktop (your current PC), run `make capture` and log in. Then copy the
  logged-in browser profile *and* the session to the VPS:
  ```bash
  # from your desktop machine:
  rsync -a backend/.chrome-capture/ quotex@VPS:/opt/quotex/backend/.chrome-capture/
  rsync -a backend/.env             quotex@VPS:/opt/quotex/backend/.env
  ```
  On the VPS set `QX_AUTO_REFRESH=true` in `backend/.env`. The feed then refreshes
  the session itself, **invisibly via Xvfb**, whenever it expires — no display
  needed. (The profile's "remember me" login lasts weeks; if it ever lapses,
  re-capture locally and rsync again.)

- Alternative: do the first `make capture` on the VPS over **VNC or X11
  forwarding** (`ssh -X`), then let `QX_AUTO_REFRESH=true` take over.

Set the rest of `backend/.env` for production:
```
QX_AUTO_REFRESH=true
FEED_ASSETS=ALL_OPEN          # or a small list; smaller = gentler on Quotex
REDIS_URL=redis://localhost:6379/0
```

### 1d. Run as services

```bash
sudo cp deploy/systemd/quotex-feed.service deploy/systemd/quotex-api.service \
        /etc/systemd/system/
# edit both: set User=, WorkingDirectory=, and in quotex-api set WEBAPI_CORS to
# your Vercel URL (below). Then:
sudo systemctl daemon-reload
sudo systemctl enable --now quotex-feed quotex-api
journalctl -u quotex-feed -f          # watch it connect + stream
```

The API now listens on `127.0.0.1:8000` (not public yet — Caddy exposes it).

### 1e. HTTPS + WebSocket via Caddy

Point a DNS `A` record `api.yourdomain.com` → your VPS IP, then:

```bash
sudo apt install -y caddy               # or per caddyserver.com/docs/install
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile          # replace api.yourdomain.com
sudo systemctl reload caddy             # auto-fetches a Let's Encrypt cert
```

Verify: `curl https://api.yourdomain.com/api/status` returns JSON. Caddy proxies
`/ws` as WSS automatically.

---

## 2. Frontend on Vercel

1. Push the repo to GitHub and **import it into Vercel**.
2. In the Vercel project settings:
   - **Root Directory:** `frontend`  (the app lives in a subfolder).
   - Framework preset: **Vite** (auto-detected; `vercel.json` also sets it).
3. **Environment Variable** (Project → Settings → Environment Variables):
   ```
   VITE_API_BASE = https://api.yourdomain.com
   ```
   This is required in production — without it the app would try to call the API
   on its own Vercel host. (Locally it auto-targets `localhost:8000`.)
4. Deploy. Vercel runs `npm run build` and serves `frontend/dist`.

The frontend derives the WebSocket URL from `VITE_API_BASE` (`https` → `wss`), so
with the Caddy HTTPS setup above, live updates work over `wss://`.

---

## 3. Wire CORS

In `deploy/systemd/quotex-api.service` set:
```
Environment=WEBAPI_CORS=https://your-project.vercel.app
```
(Add your custom domain too, comma-separated, if you attach one.) Reload:
```bash
sudo systemctl daemon-reload && sudo systemctl restart quotex-api
```
WebSocket connections aren't subject to CORS, but the REST calls are — so this
must match the exact Vercel origin.

---

## 4. Checklist

- [ ] DNS `api.yourdomain.com` → VPS, Caddy serving HTTPS.
- [ ] `curl https://api.yourdomain.com/api/status` → JSON.
- [ ] `quotex-feed` connected (`journalctl -u quotex-feed`), Redis filling.
- [ ] `WEBAPI_CORS` = the Vercel origin.
- [ ] Vercel `VITE_API_BASE` = `https://api.yourdomain.com`, Root Directory =
      `frontend`.
- [ ] Open the Vercel URL → LIVE badge, prices, signals.

## Notes & gotchas

- **Datacenter IP is fine for the WebSocket** (it's cleared by the curl_cffi
  browser-TLS impersonation, not the IP). What bites is **connection churn** —
  keep restarts/checks minimal, use `QX_AUTO_REFRESH`, and a dedicated account
  (see DIAGNOSE_WS_403.md → throttling).
- **Redis stays internal** (localhost). Don't expose 6379 publicly.
- **Scaling:** one feed serves unlimited frontend viewers (they only touch the
  API). To scale the API, run several `quotex-api` workers behind Caddy — they're
  stateless readers of Redis.
- **Updates:** `git pull`, `make install` (rebuilds), then
  `sudo systemctl restart quotex-feed quotex-api`; Vercel redeploys the frontend
  on push automatically.
