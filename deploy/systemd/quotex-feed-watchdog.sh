#!/bin/bash
# Restart quotex-feed only when its health heartbeat is frozen (event loop hung).
# Do not restart for session_expired / stalled while heartbeats still publish.
set -euo pipefail
export PATH="/usr/bin:/bin"
python3 - <<'PY'
import json, subprocess, sys, time

def redis_get(key: str) -> str:
    try:
        return subprocess.check_output(["redis-cli", "get", key], text=True, timeout=3).strip()
    except Exception:
        return ""

raw = redis_get("feed:health")
if not raw or raw == "(nil)":
    sys.exit(0)
try:
    d = json.loads(raw)
except Exception:
    sys.exit(0)
ts = float(d.get("ts") or 0)
if ts <= 0:
    sys.exit(0)
age = time.time() - ts
if age < 180:
    sys.exit(0)
print(f"feed health stale {age:.0f}s — restarting quotex-feed", flush=True)
subprocess.run(["systemctl", "restart", "quotex-feed"], check=False)
PY
