#!/usr/bin/env python3
"""Capture a fresh Quotex session into backend/.env — the interactive login.

Opens a real Chrome window (a normal browser, so Cloudflare passes). Log into
your Quotex **demo** account and open a chart; this writes QX_SSID / QX_COOKIES /
QX_USER_AGENT to backend/.env. Run once to set up the persistent profile; after
that the backend can refresh sessions automatically (QX_AUTO_REFRESH=true).

    python backend/tools/capture_session.py        # or: make capture
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
ENV_PATH = BACKEND / ".env"
PROFILE_DIR = BACKEND / ".chrome-capture"

from feed.session_capture import capture_session, write_env_session, find_chrome  # noqa: E402


def _manual_hint() -> None:
    print(
        "\nManual fallback (uses your real browser):\n"
        "  1. Log into Quotex normally and open a chart.\n"
        "  2. DevTools (F12): QX_USER_AGENT = navigator.userAgent; QX_COOKIES =\n"
        "     the 'cookie:' request header on any qxbroker.com request (has\n"
        "     cf_clearance); QX_SSID = the WS 42[\"authorization\",{\"session\":…}] frame.\n"
        "  3. Put them in backend/.env. See DIAGNOSE_WS_403.md."
    )


async def main() -> int:
    if not find_chrome():
        print("No Chrome/Chromium found.")
        _manual_hint()
        return 2

    print("Opening Chrome — log into your Quotex DEMO account and open a chart.")
    print("(A normal browser window; the Cloudflare check will pass.)\n")
    result = await capture_session(PROFILE_DIR, interactive=True, timeout=300)
    if not result:
        print("\nCapture timed out or failed — make sure you logged in and a chart loaded.")
        _manual_hint()
        return 1

    ssid, cookies, ua = result
    if "cf_clearance" not in cookies:
        print("  ⚠ cf_clearance not captured — retry and ensure a live chart loaded.")
    write_env_session(ENV_PATH, ssid, cookies, ua)
    print(f"\n✓ Wrote QX_SSID / QX_COOKIES / QX_USER_AGENT to {ENV_PATH}")
    print("  (previous .env backed up to backend/.env.bak)")
    print("  The login is saved in backend/.chrome-capture — enable hands-free")
    print("  refresh with QX_AUTO_REFRESH=true in backend/.env.")
    print("\nNow verify:  make check")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(main()))
    except KeyboardInterrupt:
        print("\nCancelled.")
        sys.exit(130)
