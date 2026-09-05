"""Reusable Quotex session capture.

Launches a **normal** Chrome (a plain subprocess, not an automation-driven
browser) so Cloudflare's bot check passes, then attaches over the DevTools
protocol to read the session — no `navigator.webdriver` flag to detect.

Two modes:
  * interactive=True  — first-time login. Uses the real desktop display so YOU
    can log in (handling OTP + Cloudflare in the window). Long timeout.
  * interactive=False — automatic refresh. Reuses the persistent, already
    logged-in profile on an invisible Xvfb virtual display, so it mints a fresh
    session with no window and no OTP. Short timeout.

Both write nothing themselves; the caller persists the returned values.
Requires the system Chrome and `pip install playwright` (used only to attach).
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
import shutil
import socket
import subprocess
import time
import urllib.request
from pathlib import Path

logger = logging.getLogger("feed.capture")

SIGNIN_URL = "https://qxbroker.com/en/sign-in"
CHROME_CANDIDATES = ["google-chrome-stable", "google-chrome", "chromium", "chromium-browser"]
_SESSION_RE = re.compile(r'"session"\s*:\s*"([^"]+)"')


def find_chrome() -> str | None:
    for name in CHROME_CANDIDATES:
        if (path := shutil.which(name)):
            return path
    return None


def _free_port(start: int = 9222) -> int:
    for port in range(start, start + 40):
        with socket.socket() as s:
            if s.connect_ex(("127.0.0.1", port)) != 0:
                return port
    return start


def _wait_debug(port: int, timeout: float = 30) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=1)
            return True
        except Exception:
            time.sleep(0.5)
    return False


def _start_xvfb() -> tuple[subprocess.Popen | None, str | None]:
    """Start an invisible X server; returns (proc, ':N') or (None, None)."""
    if not shutil.which("Xvfb"):
        return None, None
    for n in range(99, 120):
        if os.path.exists(f"/tmp/.X{n}-lock"):
            continue
        proc = subprocess.Popen(
            ["Xvfb", f":{n}", "-screen", "0", "1280x800x24"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        time.sleep(1.5)
        return proc, f":{n}"
    return None, None


async def capture_session(
    profile_dir: Path,
    *,
    interactive: bool,
    timeout: int,
    chrome_path: str | None = None,
) -> tuple[str, str, str] | None:
    """Capture (ssid, cookies, user_agent) from a Quotex browser session.

    Returns None on failure (no Chrome, no Playwright, timeout, etc.).
    """
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        logger.warning("Playwright not installed — cannot capture. `pip install playwright`.")
        return None

    chrome = chrome_path or find_chrome()
    if not chrome:
        logger.warning("No Chrome/Chromium binary found for capture.")
        return None

    profile_dir.mkdir(parents=True, exist_ok=True)
    xvfb_proc: subprocess.Popen | None = None
    display = os.environ.get("DISPLAY")
    args_extra = ["--disable-blink-features=AutomationControlled"]

    if not interactive:
        # Automatic mode: invisible, and needs the server-safe flags.
        xvfb_proc, xdisplay = _start_xvfb()
        if xdisplay:
            display = xdisplay
        args_extra += ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"]

    if not display:
        logger.warning("No display available for the capture browser.")
        return None

    port = _free_port()
    env = dict(os.environ, DISPLAY=display)
    proc = subprocess.Popen(
        [chrome, f"--remote-debugging-port={port}", f"--user-data-dir={profile_dir}",
         "--no-first-run", "--no-default-browser-check", *args_extra, SIGNIN_URL],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env,
    )

    def _cleanup():
        proc.terminate()
        if xvfb_proc:
            xvfb_proc.terminate()

    if not _wait_debug(port):
        logger.warning("Capture browser did not expose its debug port.")
        _cleanup()
        return None

    captured: dict[str, str] = {}

    def on_frame(payload) -> None:
        text = payload if isinstance(payload, str) else str(payload)
        if "authorization" in text and "session" in text and "ssid" not in captured:
            if (m := _SESSION_RE.search(text)):
                captured["ssid"] = m.group(1)

    def attach(page) -> None:
        page.on("websocket", lambda ws: ws.on("framesent", on_frame))

    try:
        async with async_playwright() as p:
            browser = await p.chromium.connect_over_cdp(f"http://127.0.0.1:{port}")
            ctx = browser.contexts[0] if browser.contexts else await browser.new_context()
            page = None
            for _ in range(20):
                if ctx.pages:
                    page = ctx.pages[0]
                    break
                await asyncio.sleep(0.5)
            if page is None:
                _cleanup()
                return None
            for pg in ctx.pages:
                attach(pg)
            ctx.on("page", attach)

            for _ in range(timeout * 2):
                if "ssid" in captured:
                    break
                await asyncio.sleep(0.5)

            if "ssid" not in captured:
                return None

            ua = await page.evaluate("navigator.userAgent")
            cookie_objs = await ctx.cookies("https://qxbroker.com")
            cookies = "; ".join(f"{c['name']}={c['value']}" for c in cookie_objs)
            return captured["ssid"], cookies, ua
    except Exception:
        logger.exception("Capture failed")
        return None
    finally:
        _cleanup()


def write_env_session(env_path: Path, ssid: str, cookies: str, ua: str) -> None:
    """Write the three session values into a .env file, backing it up."""
    lines = env_path.read_text().splitlines() if env_path.exists() else []
    if env_path.exists():
        shutil.copy(env_path, env_path.with_name(".env.bak"))
    updates = {"QX_SSID": ssid, "QX_COOKIES": cookies, "QX_USER_AGENT": ua}
    seen: set[str] = set()
    out: list[str] = []
    for ln in lines:
        key = ln.split("=", 1)[0] if "=" in ln else None
        if key in updates:
            out.append(f"{key}={updates[key]}")
            seen.add(key)
        else:
            out.append(ln)
    for key, val in updates.items():
        if key not in seen:
            out.append(f"{key}={val}")
    env_path.write_text("\n".join(out) + "\n")
