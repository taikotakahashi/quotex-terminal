"""Load settings from backend/.env."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _load_dotenv() -> None:
    candidates = [
        Path(__file__).resolve().parents[2] / ".env",  # backend/.env
        Path.cwd() / ".env",
        Path.cwd() / "backend" / ".env",
    ]
    for env in candidates:
        if not env.exists():
            continue
        for line in env.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            k = k.strip()
            v = v.strip()
            if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
                v = v[1:-1]
            os.environ.setdefault(k, v)
        break


_load_dotenv()


@dataclass(frozen=True)
class BotSettings:
    bot_token: str
    bot_username: str
    redis_url: str
    database_url: str
    app_public_url: str
    default_lang: str


def load_settings() -> BotSettings:
    token = (os.getenv("TELEGRAM_BOT_TOKEN") or "").strip()
    user = (os.getenv("TELEGRAM_BOT_USERNAME") or "quotex_notification_bot").strip().lstrip("@")
    if not token:
        raise RuntimeError("TELEGRAM_BOT_TOKEN is required")
    return BotSettings(
        bot_token=token,
        bot_username=user,
        redis_url=os.getenv("REDIS_URL", "redis://localhost:6379/0"),
        database_url=os.getenv(
            "DATABASE_URL",
            "postgresql+asyncpg://quotex:quotex@localhost:5432/quotex",
        ),
        app_public_url=os.getenv("APP_PUBLIC_URL", "http://localhost:5173").rstrip("/"),
        default_lang=(os.getenv("TG_DEFAULT_LANG") or "pt").strip().lower() or "pt",
    )
