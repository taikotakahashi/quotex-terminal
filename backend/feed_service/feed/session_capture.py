"""Reusable Quotex session capture.

Launches a **normal** Chrome (a plain subprocess, not an automation-driven
browser) so Cloudflare's bot check passes, then attaches over the DevTools
protocol to read the session — no `navigator.webdriver` flag to detect.

Two modes:
  * interactive=True  — first-time login. Uses the real desktop display so YOU
    can log in (handling OTP + Cloudflare in the window). Long timeout.
  * interactive=False — automatic refresh. Reuses the persistent, already
    logged-in profile. On Linux headless boxes this uses Xvfb; on Windows (or
    any machine with a real desktop) Chrome opens on the GUI session — keep a
    user logged into the Windows desktop so auto-refresh can see the display.

When the saved profile is logged out, optional email/password auto-login can
fill the Quotex sign-in form (QX_AUTO_LOGIN). Cloudflare challenges and email
OTP still often need a human — this is best-effort, not guaranteed.
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

logger = logging.getLogger("feed.capture")

SIGNIN_URL = "https://qxbroker.com/en/sign-in"
CHROME_CANDIDATES = ["google-chrome-stable", "google-chrome", "chromium", "chromium-browser"]
_SESSION_RE = re.compile(r'"session"\s*:\s*"([^"]+)"')

_WIN_CHROME_PATHS = (
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
)


def _is_windows() -> bool:
    return sys.platform == "win32"


def find_chrome() -> str | None:
    for name in CHROME_CANDIDATES:
        if (path := shutil.which(name)):
            return path
    if _is_windows():
        for name in ("chrome.exe", "msedge.exe"):
            if (path := shutil.which(name)):
                return path
        local = os.environ.get("LOCALAPPDATA", "")
        extras = list(_WIN_CHROME_PATHS)
        if local:
            extras.extend(
                (
                    str(Path(local) / "Google" / "Chrome" / "Application" / "chrome.exe"),
                    str(Path(local) / "Microsoft" / "Edge" / "Application" / "msedge.exe"),
                )
            )
        for path in extras:
            if Path(path).is_file():
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
    """Start an invisible X server; returns (proc, ':N') or (None, None). Linux only."""
    if _is_windows() or not shutil.which("Xvfb"):
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


def _browser_home() -> str:
    """Home directory Chrome should use (must exist or Chrome may abort early)."""
    if _is_windows():
        return os.environ.get("USERPROFILE") or str(Path.home())
    home = os.environ.get("HOME") or str(Path.home())
    try:
        import pwd

        home = pwd.getpwuid(os.getuid()).pw_dir or home
    except Exception:
        pass
    return home


async def _page_looks_like_signin(page) -> bool:
    try:
        url = (page.url or "").lower()
    except Exception:
        return False
    if "sign-in" in url or "signin" in url or "login" in url:
        return True
    try:
        return bool(
            await page.query_selector(
                'input[name="email"], input[type="email"], input[name="password"]'
            )
        )
    except Exception:
        return False


async def _try_form_login(page, email: str, password: str, otp: str = "") -> bool:
    """Best-effort fill of the Quotex sign-in form. Returns True if submit was clicked."""
    if not email or not password:
        return False
    if not await _page_looks_like_signin(page):
        return False

    logger.info("Auto-login: Quotex sign-in page detected — filling credentials…")
    try:
        # Open the email/password modal if the landing page only shows social/CTA buttons.
        for sel in (
            'a[href*="sign-in"]',
            'button:has-text("Sign in")',
            'button:has-text("Log in")',
            'button:has-text("Entrar")',
            'a:has-text("Sign in")',
            'a:has-text("Log in")',
            '[data-testid="sign-in"]',
        ):
            try:
                btn = page.locator(sel).first
                if await btn.count() and await btn.is_visible():
                    await btn.click(timeout=3000)
                    await asyncio.sleep(1.0)
                    break
            except Exception:
                continue

        email_sel = 'input[name="email"]:visible, input[type="email"]:visible'
        pass_sel = 'input[name="password"]:visible, input[type="password"]:visible'
        # Fall back to any matching field if :visible filter finds nothing.
        email_el = page.locator(email_sel).first
        if await email_el.count() == 0:
            email_el = page.locator('input[name="email"], input[type="email"]').last
        pass_el = page.locator(pass_sel).first
        if await pass_el.count() == 0:
            pass_el = page.locator('input[name="password"], input[type="password"]').last

        if await email_el.count() == 0 or await pass_el.count() == 0:
            logger.warning("Auto-login: email/password fields not found.")
            return False

        await email_el.wait_for(state="visible", timeout=15000)
        await pass_el.wait_for(state="visible", timeout=15000)
        await email_el.click(timeout=5000)
        await email_el.fill(email)
        await pass_el.click(timeout=5000)
        await pass_el.fill(password)

        try:
            remember = page.locator('input[name="remember"]').first
            if await remember.count() and not await remember.is_checked():
                await remember.check(force=True)
        except Exception:
            pass

        submit = page.locator(
            'button[type="submit"]:visible, form button:visible'
        ).first
        if await submit.count():
            await submit.click(timeout=5000)
        else:
            await pass_el.press("Enter")
        logger.info("Auto-login: submitted sign-in form.")
    except Exception:
        logger.exception("Auto-login: form fill failed")
        return False

    if otp:
        for _ in range(20):
            await asyncio.sleep(0.5)
            try:
                otp_el = page.locator(
                    'input[name="code"]:visible, input[name="otp"]:visible, '
                    'input[autocomplete="one-time-code"]:visible'
                ).first
                if await otp_el.count() == 0:
                    if not await _page_looks_like_signin(page):
                        break
                    continue
                await otp_el.fill(otp)
                otp_submit = page.locator('button[type="submit"]:visible, form button:visible').first
                if await otp_submit.count():
                    await otp_submit.click(timeout=5000)
                else:
                    await otp_el.press("Enter")
                logger.info("Auto-login: submitted OTP.")
                break
            except Exception:
                continue
    return True


async def capture_session(
    profile_dir: Path,
    *,
    interactive: bool,
    timeout: int,
    chrome_path: str | None = None,
    email: str | None = None,
    password: str | None = None,
    otp: str | None = None,
    auto_login: bool = False,
) -> tuple[str, str, str] | None:
    """Capture (ssid, cookies, user_agent) from a Quotex browser session.

    Returns None on failure (no Chrome, no Playwright, timeout, etc.).
    Blocking Chrome/Xvfb waits run in a worker thread so the feed heartbeat
    keeps publishing during auto-refresh.

    When ``auto_login`` is True and credentials are provided, fills the sign-in
    form if the profile lands on the login page (logged-out profile recovery).
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
    windows = _is_windows()

    if not interactive and not windows:
        # Linux automatic mode: use Xvfb only when no desktop display is available.
        if not display:
            xvfb_proc, xdisplay = await asyncio.to_thread(_start_xvfb)
            if xdisplay:
                display = xdisplay
        args_extra += ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"]
    elif not interactive and windows:
        # Windows GUI VPS: Chrome uses the interactive desktop (no Xvfb). Prefer
        # running the feed under a logged-in user session, not Session 0.
        args_extra += ["--disable-gpu"]

    if not windows and not display:
        logger.warning("No display available for the capture browser.")
        return None

    port = _free_port()
    home = _browser_home()
    env = dict(os.environ)
    env["HOME"] = home
    if display:
        env["DISPLAY"] = display
    if windows:
        env.setdefault("USERPROFILE", home)
    # Drop stale profile locks that block Chrome from starting.
    for name in ("SingletonLock", "SingletonSocket", "SingletonCookie"):
        try:
            (profile_dir / name).unlink(missing_ok=True)
        except Exception:
            pass
    creationflags = 0
    if windows:
        # Avoid flashing a console window when Chrome is launched from a service.
        creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    proc = subprocess.Popen(
        [chrome, f"--remote-debugging-port={port}", f"--user-data-dir={str(profile_dir)}",
         "--no-first-run", "--no-default-browser-check", *args_extra, SIGNIN_URL],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env,
        creationflags=creationflags,
    )

    def _cleanup():
        try:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except Exception:
                proc.kill()
        except Exception:
            pass
        if xvfb_proc:
            try:
                xvfb_proc.terminate()
            except Exception:
                pass

    if not await asyncio.to_thread(_wait_debug, port):
        logger.warning("Capture browser did not expose its debug port.")
        _cleanup()
        return None

    captured: dict[str, str] = {}
    login_attempted = False

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

            # Wait for an already-logged-in profile to mint a session; if still on
            # the sign-in page, optionally fill credentials once.
            soft_wait = min(20, max(8, timeout // 4))
            for i in range(timeout * 2):
                if "ssid" in captured:
                    break
                if (
                    auto_login
                    and not login_attempted
                    and not interactive
                    and email
                    and password
                    and i >= soft_wait * 2
                ):
                    login_attempted = True
                    await _try_form_login(page, email, password, otp or "")
                await asyncio.sleep(0.5)

            if "ssid" not in captured:
                if login_attempted:
                    logger.warning(
                        "Auto-login submitted but no session appeared "
                        "(Cloudflare challenge or email OTP likely)."
                    )
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
