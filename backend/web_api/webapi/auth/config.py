"""Auth settings loaded from environment (web_api)."""
from __future__ import annotations

import os
from dataclasses import dataclass


def _bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


@dataclass(frozen=True)
class AuthSettings:
    database_url: str
    session_secret: str
    session_ttl_days: int
    cookie_name: str
    cookie_secure: bool
    csrf_cookie_name: str
    app_public_url: str
    email_from: str
    smtp_host: str
    smtp_port: int
    smtp_user: str
    smtp_password: str
    smtp_tls: bool
    auth_required: bool
    verify_token_hours: int
    reset_token_hours: int
    cors_origins: list[str]
    expose_email_urls: bool


def load_auth_settings() -> AuthSettings:
    cors = [o.strip() for o in os.getenv("WEBAPI_CORS", "http://localhost:5173").split(",") if o.strip()]
    return AuthSettings(
        database_url=os.getenv(
            "DATABASE_URL",
            "postgresql+asyncpg://quotex:quotex@localhost:5432/quotex",
        ),
        session_secret=os.getenv("SESSION_SECRET", "dev-only-change-me"),
        session_ttl_days=int(os.getenv("SESSION_TTL_DAYS", "30")),
        cookie_name=os.getenv("COOKIE_NAME", "qx_session"),
        cookie_secure=_bool("COOKIE_SECURE", False),
        csrf_cookie_name=os.getenv("CSRF_COOKIE_NAME", "qx_csrf"),
        app_public_url=os.getenv("APP_PUBLIC_URL", "http://localhost:5173").rstrip("/"),
        email_from=os.getenv("EMAIL_FROM", "Quotex Signals <noreply@localhost>"),
        smtp_host=os.getenv("SMTP_HOST", "127.0.0.1"),
        smtp_port=int(os.getenv("SMTP_PORT", "1025")),
        smtp_user=os.getenv("SMTP_USER", ""),
        smtp_password=os.getenv("SMTP_PASSWORD", ""),
        smtp_tls=_bool("SMTP_TLS", False),
        auth_required=_bool("AUTH_REQUIRED", True),
        verify_token_hours=int(os.getenv("VERIFY_TOKEN_HOURS", "24")),
        reset_token_hours=int(os.getenv("RESET_TOKEN_HOURS", "2")),
        cors_origins=cors,
        expose_email_urls=_bool("AUTH_EXPOSE_EMAIL_URLS", False),
    )
