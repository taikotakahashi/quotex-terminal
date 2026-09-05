#!/usr/bin/env bash
# serve-no-domain.sh — Serve the Quotex dashboard over plain HTTP on this VPS's
# public IP, no domain required. Builds the frontend, installs/config Caddy to
# serve it + proxy /api and /ws to the backend on one origin, opens port 80.
#
# Prereqs: the backend services (quotex-feed + quotex-api) should already be
# running (curl http://127.0.0.1:8000/api/status returns JSON).
#
# Run ON THE VPS, from the repo root:
#     sudo bash deploy/serve-no-domain.sh
#
# Idempotent — safe to re-run after a `git pull` (it just rebuilds + reloads).
set -euo pipefail

# --- locate the repo root (this script lives in <repo>/deploy) ---
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="$REPO/frontend/dist"

# --- must be root: writes /etc/caddy, installs packages, opens the firewall ---
if [ "$(id -u)" -ne 0 ]; then
  echo "Please run with sudo:  sudo bash $0"; exit 1
fi

# --- detect the public IP the browser will use ---
IP="$(curl -fsS --max-time 8 ifconfig.me 2>/dev/null || true)"
[ -z "$IP" ] && IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
if [ -z "$IP" ]; then echo "!! Could not detect a public IP. Set IP=... manually."; exit 1; fi
echo ">> Public IP: $IP"

# --- warn (don't fail) if the backend API isn't up yet ---
if curl -fsS --max-time 5 http://127.0.0.1:8000/api/status >/dev/null 2>&1; then
  echo ">> Backend API responding on 127.0.0.1:8000"
else
  echo "!! WARNING: backend API not responding on 127.0.0.1:8000."
  echo "   Start it first:  systemctl status quotex-feed quotex-api --no-pager"
fi

# --- ensure Node, then build the frontend with the IP baked in ---
if ! command -v npm >/dev/null 2>&1; then
  echo ">> Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
echo ">> Building frontend (VITE_API_BASE=http://$IP) ..."
cd "$REPO/frontend"
echo "VITE_API_BASE=http://$IP" > .env.production
npm ci --no-fund --no-audit 2>/dev/null || npm install --no-fund --no-audit
npm run build
echo ">> Built: $DIST"

# --- ensure Caddy is installed ---
if ! command -v caddy >/dev/null 2>&1; then
  echo ">> Installing Caddy..."
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update && apt-get install -y caddy
fi

# --- write the Caddyfile: HTTP on :80, static SPA + /api + /ws proxy ---
echo ">> Writing /etc/caddy/Caddyfile ..."
cat > /etc/caddy/Caddyfile <<EOF
:80 {
    encode gzip

    # REST + WebSocket -> backend (same origin, so no CORS needed).
    @backend path /api/* /ws
    handle @backend {
        reverse_proxy 127.0.0.1:8000
    }

    # Everything else -> the static dashboard.
    handle {
        root * $DIST
        try_files {path} /index.html
        file_server
    }
}
EOF

# --- open port 80 if ufw is active ---
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  echo ">> Opening TCP 80 in ufw ..."
  ufw allow 80/tcp || true
fi

# --- (re)start Caddy ---
systemctl enable caddy >/dev/null 2>&1 || true
systemctl restart caddy
sleep 1

# --- verify through Caddy ---
echo ">> Verifying ..."
curl -fsS  --max-time 5 http://127.0.0.1/api/status >/dev/null 2>&1 \
  && echo "   API OK through Caddy" || echo "   !! API not reachable through Caddy (is quotex-api running?)"
curl -fsSI --max-time 5 http://127.0.0.1/ 2>/dev/null | head -1 || true

cat <<EOF

==================================================================
 Done.  Open in your browser:   http://$IP/

 If it loads on the VPS (curl above) but NOT in your browser, open
 inbound TCP 80 in your VPS provider's cloud firewall / security group.
==================================================================
EOF
