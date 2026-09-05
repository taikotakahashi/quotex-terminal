#!/usr/bin/env python3
"""Log out / switch Quotex account.

Removes the saved browser profile and blanks the session values in backend/.env
so the next `make capture` starts on the Quotex login page (for the new
account). Does NOT touch QUOTEX_EMAIL/PASSWORD or any other settings.

    python backend/tools/reset_session.py      # or: make logout
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
ENV = BACKEND / ".env"
PROFILE = BACKEND / ".chrome-capture"

SESSION_KEYS = ("QX_SSID", "QX_COOKIES", "QX_USER_AGENT")


def main() -> int:
    # 1) remove the logged-in browser profile
    if PROFILE.exists():
        shutil.rmtree(PROFILE, ignore_errors=True)
        print(f"Removed saved browser profile: {PROFILE}")
    else:
        print("No saved browser profile to remove.")

    # 2) blank the session values in .env (keep the keys, keep everything else)
    if ENV.exists():
        shutil.copy(ENV, BACKEND / ".env.bak")
        out = []
        for line in ENV.read_text().splitlines():
            key = line.split("=", 1)[0] if "=" in line else None
            out.append(f"{key}=" if key in SESSION_KEYS else line)
        ENV.write_text("\n".join(out) + "\n")
        print(f"Cleared {', '.join(SESSION_KEYS)} in {ENV} (backup: .env.bak)")
    else:
        print(f"No {ENV} found.")

    print("\nNext:")
    print("  1. (optional) update QUOTEX_EMAIL / QUOTEX_PASSWORD in backend/.env")
    print("     to the new account.")
    print("  2. make capture   → log into the NEW account, then make check.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
