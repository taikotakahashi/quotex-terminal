"""CLI: create a verified admin user for local bootstrap."""
from __future__ import annotations

import argparse
import asyncio
import os
import sys

# Allow `python -m webapi.auth.create_admin` from backend/ with .env loaded.
from pathlib import Path


def _load_dotenv() -> None:
    env = Path(__file__).resolve().parents[3] / ".env"  # backend/.env
    if not env.exists():
        env = Path.cwd() / ".env"
    if not env.exists():
        return
    for line in env.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        os.environ.setdefault(k.strip(), v.strip())


async def _run(email: str, password: str) -> None:
    from sqlalchemy import select

    from .db import SessionLocal, init_db
    from .models import User
    from .security import hash_password
    from datetime import datetime, timezone

    await init_db()
    email = email.lower().strip()
    async with SessionLocal() as db:
        result = await db.execute(select(User).where(User.email == email))
        user = result.scalar_one_or_none()
        if user:
            user.password_hash = hash_password(password)
            user.role = "admin"
            user.is_active = True
            user.email_verified_at = datetime.now(timezone.utc)
            print(f"Updated existing user to verified admin: {email}")
        else:
            db.add(
                User(
                    email=email,
                    password_hash=hash_password(password),
                    role="admin",
                    email_verified_at=datetime.now(timezone.utc),
                )
            )
            print(f"Created verified admin: {email}")
        await db.commit()


def main() -> None:
    _load_dotenv()
    p = argparse.ArgumentParser(description="Create or update a verified admin user")
    p.add_argument("--email", required=True)
    p.add_argument("--password", required=True)
    args = p.parse_args()
    if len(args.password) < 8:
        print("Password must be at least 8 characters", file=sys.stderr)
        raise SystemExit(1)
    asyncio.run(_run(args.email, args.password))


if __name__ == "__main__":
    main()
