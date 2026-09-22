"""Website ↔ Telegram link API (Connect button)."""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from .auth.db import get_db
from .auth.deps import require_verified_user
from .auth.models import TelegramLink, TelegramLinkToken, User
from .auth.security import hash_token, new_token
from .telegram_prefs import DEFAULT_TELEGRAM_PREFS, normalize_prefs

router = APIRouter(prefix="/api/telegram", tags=["telegram"])

_LINK_TTL_MINUTES = 10


def _bot_username() -> str:
    raw = (os.getenv("TELEGRAM_BOT_USERNAME") or "").strip().lstrip("@")
    return raw


def _deep_link(raw_token: str) -> str:
    user = _bot_username()
    if not user:
        raise HTTPException(
            status_code=503,
            detail="Telegram bot is not configured (TELEGRAM_BOT_USERNAME)",
        )
    # Telegram start payload max 64 chars; "link_" + urlsafe(24) fits.
    return f"https://t.me/{user}?start=link_{raw_token}"


class TelegramStatusOut(BaseModel):
    configured: bool
    bot_username: str | None
    linked: bool
    enabled: bool
    telegram_username: str | None = None
    prefs: dict | None = None


class TelegramLinkOut(BaseModel):
    ok: bool
    deep_link: str
    bot_username: str
    expires_in_sec: int


@router.get("/status", response_model=TelegramStatusOut)
async def telegram_status(
    user: User = Depends(require_verified_user),
    db: AsyncSession = Depends(get_db),
):
    bot = _bot_username() or None
    result = await db.execute(select(TelegramLink).where(TelegramLink.user_id == user.id))
    link = result.scalar_one_or_none()
    if link is None:
        return TelegramStatusOut(
            configured=bool(bot),
            bot_username=bot,
            linked=False,
            enabled=False,
        )
    return TelegramStatusOut(
        configured=bool(bot),
        bot_username=bot,
        linked=True,
        enabled=bool(link.enabled),
        telegram_username=link.telegram_username,
        prefs=normalize_prefs(link.prefs if isinstance(link.prefs, dict) else None),
    )


@router.post("/link", response_model=TelegramLinkOut)
async def create_telegram_link(
    user: User = Depends(require_verified_user),
    db: AsyncSession = Depends(get_db),
):
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account disabled")
    if user.email_verified_at is None:
        raise HTTPException(status_code=403, detail={"code": "email_not_verified"})
    if not _bot_username():
        raise HTTPException(
            status_code=503,
            detail="Telegram bot is not configured (TELEGRAM_BOT_USERNAME)",
        )
    if not (os.getenv("TELEGRAM_BOT_TOKEN") or "").strip():
        raise HTTPException(
            status_code=503,
            detail="Telegram bot is not configured (TELEGRAM_BOT_TOKEN)",
        )

    raw = new_token(24)
    now = datetime.now(timezone.utc)
    row = TelegramLinkToken(
        user_id=user.id,
        token_hash=hash_token(raw),
        expires_at=now + timedelta(minutes=_LINK_TTL_MINUTES),
    )
    db.add(row)
    await db.commit()
    return TelegramLinkOut(
        ok=True,
        deep_link=_deep_link(raw),
        bot_username=_bot_username(),
        expires_in_sec=_LINK_TTL_MINUTES * 60,
    )


@router.delete("/link")
async def unlink_telegram(
    user: User = Depends(require_verified_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(TelegramLink).where(TelegramLink.user_id == user.id))
    link = result.scalar_one_or_none()
    if link is None:
        return {"ok": True, "linked": False}
    await db.delete(link)
    await db.commit()
    return {"ok": True, "linked": False}


async def redeem_link_token(
    db: AsyncSession,
    *,
    raw_token: str,
    chat_id: int,
    telegram_username: str | None,
) -> User:
    """Consume a one-time website link token and bind chat ↔ user. Raises ValueError."""
    token_hash = hash_token(raw_token)
    result = await db.execute(select(TelegramLinkToken).where(TelegramLinkToken.token_hash == token_hash))
    tok = result.scalar_one_or_none()
    if tok is None:
        raise ValueError("invalid_token")
    now = datetime.now(timezone.utc)
    exp = tok.expires_at if tok.expires_at.tzinfo else tok.expires_at.replace(tzinfo=timezone.utc)
    if tok.used_at is not None:
        raise ValueError("token_used")
    if exp < now:
        raise ValueError("token_expired")

    user = await db.get(User, tok.user_id)
    if user is None or not user.is_active:
        raise ValueError("user_inactive")
    if user.email_verified_at is None:
        raise ValueError("email_not_verified")

    # Free this chat if bound to someone else.
    other = await db.execute(select(TelegramLink).where(TelegramLink.chat_id == chat_id))
    other_link = other.scalar_one_or_none()
    if other_link is not None and other_link.user_id != user.id:
        await db.delete(other_link)

    existing = await db.execute(select(TelegramLink).where(TelegramLink.user_id == user.id))
    link = existing.scalar_one_or_none()
    if link is None:
        link = TelegramLink(
            user_id=user.id,
            chat_id=chat_id,
            telegram_username=telegram_username,
            enabled=False,
            prefs={
                **dict(DEFAULT_TELEGRAM_PREFS),
                "setup_complete": False,
                "timeframes": [],
            },
        )
        db.add(link)
    else:
        link.chat_id = chat_id
        link.telegram_username = telegram_username
        link.enabled = False
        link.prefs = {
            **normalize_prefs(link.prefs if isinstance(link.prefs, dict) else None),
            "setup_complete": False,
            "timeframes": [],
        }
        link.linked_at = now

    tok.used_at = now
    await db.commit()
    return user
