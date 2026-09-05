"""`quotex-feed --doctor`: a self-contained network diagnostic.

Answers one question on whatever machine it runs on: *will Quotex's realtime
WebSocket work from this IP?* It needs neither Redis nor valid credentials, so
you can run it on a candidate host (e.g. your residential machine) before
bothering with the full setup.

It reproduces the exact asymmetry behind the HTTP-403 problem:
  - plain HTTPS (polling) to the realtime host  → usually allowed
  - the WebSocket UPGRADE to the same host      → blocked by Cloudflare on
                                                  datacenter IPs
"""
from __future__ import annotations

import asyncio
import json
import ssl
import urllib.request
import urllib.error

import certifi

WS_HOST = "ws2.qxbroker.com"
POLL_URL = f"https://{WS_HOST}/socket.io/?EIO=3&transport=polling"
WS_URL = f"wss://{WS_HOST}/socket.io/?EIO=3&transport=websocket"

# ASN-org keywords that strongly imply a datacenter/hosting IP (Cloudflare tends
# to block WS upgrades from these). Heuristic only — the WS test is the verdict.
_DC_HINTS = (
    "host", "hosting", "cloud", "vps", "server", "data center", "datacenter",
    "colo", "ovh", "hetzner", "digitalocean", "linode", "vultr", "amazon",
    "aws", "google", "microsoft", "azure", "contabo", "leaseweb", "m247",
)


def _ssl_ctx() -> ssl.SSLContext:
    ctx = ssl.create_default_context()
    ctx.load_verify_locations(certifi.where())
    return ctx


def _lookup_ip() -> dict:
    for url in ("https://ipinfo.io/json", "https://ipapi.co/json/"):
        try:
            with urllib.request.urlopen(url, timeout=10) as r:
                return json.load(r)
        except Exception:
            continue
    return {}


def _looks_datacenter(org: str) -> bool:
    o = org.lower()
    return any(h in o for h in _DC_HINTS)


def _test_polling(cookies: str, ua: str) -> tuple[bool, str]:
    headers = {"User-Agent": ua or "Mozilla/5.0", "Origin": "https://qxbroker.com"}
    if cookies:
        headers["Cookie"] = cookies
    req = urllib.request.Request(POLL_URL, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            body = r.read(200).decode("utf-8", "replace")
            ok = r.status == 200 and '"sid"' in body
            return ok, f"status {r.status}"
    except urllib.error.HTTPError as e:
        return False, f"HTTP {e.code}"
    except Exception as e:
        return False, f"{type(e).__name__}: {e}"


async def _test_ws(cookies: str, ua: str) -> tuple[bool, str]:
    import websockets  # imported lazily so --doctor works even if optional

    headers = {"User-Agent": ua or "Mozilla/5.0", "Origin": "https://qxbroker.com"}
    if cookies:
        headers["Cookie"] = cookies
    try:
        async with websockets.connect(
            WS_URL, additional_headers=headers, ssl=_ssl_ctx(),
            open_timeout=15, compression=None, max_size=2 ** 23,
        ) as ws:
            await asyncio.wait_for(ws.recv(), timeout=10)
            return True, "connected"
    except Exception as e:
        status = getattr(getattr(e, "response", None), "status_code", None)
        is_cf = False
        resp = getattr(e, "response", None)
        if resp is not None and getattr(resp, "body", None):
            body = bytes(resp.body).decode("utf-8", "replace").lower()
            is_cf = any(s in body for s in ("attention required", "cloudflare", "challenge"))
        label = f"HTTP {status}" if status else type(e).__name__
        return False, f"{label}{' (Cloudflare block page)' if is_cf else ''}"


async def run_doctor(settings) -> int:
    print("Quotex feed doctor\n" + "=" * 40)

    info = _lookup_ip()
    ip = info.get("ip", "?")
    org = info.get("org") or info.get("asn_org") or info.get("org_name") or "?"
    country = info.get("country", "?")
    dc = _looks_datacenter(org)
    print(f"Public IP  : {ip} ({country})")
    print(f"Network    : {org}")
    print(f"IP type    : {'DATACENTER/hosting (likely blocked)' if dc else 'looks residential/ISP'}")
    print("-" * 40)

    # Use the .env session if present (more accurate); otherwise test bare.
    cookies = getattr(settings, "cookies", "") or ""
    ua = getattr(settings, "user_agent", "") or ""
    have_session = bool(cookies)
    print(f"Session    : {'using QX_COOKIES/QX_USER_AGENT from .env' if have_session else 'none (bare reachability test)'}")

    poll_ok, poll_msg = _test_polling(cookies, ua)
    print(f"HTTPS poll : {'OK ✅' if poll_ok else 'FAIL ❌'}  ({poll_msg})")

    ws_ok, ws_msg = await _test_ws(cookies, ua)
    print(f"WS upgrade : {'OK ✅' if ws_ok else 'FAIL ❌'}  ({ws_msg})")
    print("=" * 40)

    if ws_ok:
        print("VERDICT: ✅ This IP works for Quotex realtime. Run the feed HERE.")
        if have_session:
            print("         `quotex-feed --check` should now pass end-to-end.")
        return 0

    if poll_ok and not ws_ok:
        print("VERDICT: ❌ Cloudflare is blocking the WebSocket from this IP.")
        if dc:
            print("         This is a datacenter/VPS IP — the known cause.")
        print("         Fix: run the feed from a RESIDENTIAL IP (capture the")
        print("         browser session on that same machine), or route through")
        print("         a residential proxy (QX_PROXY). See DIAGNOSE_WS_403.md.")
        if not have_session:
            print("         Note: run again with a captured session in .env for a")
            print("         definitive check (a bare test can 403 for lack of cookies).")
        return 1

    print("VERDICT: ❌ Can't even reach the realtime host over HTTPS.")
    print("         Check connectivity / DNS / geo-blocking from this machine.")
    return 2
