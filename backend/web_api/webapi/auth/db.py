"""SQLAlchemy async engine / session factory."""
from __future__ import annotations

from collections.abc import AsyncIterator

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from .config import load_auth_settings


class Base(DeclarativeBase):
    pass


_settings = load_auth_settings()
engine = create_async_engine(_settings.database_url, pool_pre_ping=True)
SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

_PROFILE_COLUMNS = (
    ("full_name", "VARCHAR(120)"),
    ("username", "VARCHAR(64)"),
    ("avatar_path", "VARCHAR(512)"),
    ("last_seen_at", "TIMESTAMPTZ"),
)


async def _ensure_profile_columns(conn) -> None:
    """create_all won't add columns to existing tables — patch locally."""
    for name, col_type in _PROFILE_COLUMNS:
        await conn.execute(text(f"ALTER TABLE users ADD COLUMN IF NOT EXISTS {name} {col_type}"))
    await conn.execute(
        text(
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_username ON users (username) "
            "WHERE username IS NOT NULL"
        )
    )


async def init_db() -> None:
    # Local-first: create tables if missing. Alembic can replace this later.
    from . import models  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await _ensure_profile_columns(conn)


async def get_db() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session
