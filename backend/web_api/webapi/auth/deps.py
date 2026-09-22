"""FastAPI dependencies for the current user / session."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from .config import load_auth_settings
from .db import get_db
from .models import Session, User
from .security import hash_token

# Don't write last_seen on every request — throttle DB updates.
_SEEN_TOUCH_SECONDS = 45


async def _load_session(request: Request, db: AsyncSession) -> Session | None:
    settings = load_auth_settings()
    raw = request.cookies.get(settings.cookie_name)
    if not raw:
        return None
    token_hash = hash_token(raw)
    result = await db.execute(
        select(Session)
        .where(Session.token_hash == token_hash)
        .options(selectinload(Session.user))
    )
    sess = result.scalar_one_or_none()
    if sess is None:
        return None
    now = datetime.now(timezone.utc)
    if sess.revoked_at is not None:
        return None
    exp = sess.expires_at if sess.expires_at.tzinfo else sess.expires_at.replace(tzinfo=timezone.utc)
    if exp < now:
        return None
    if not sess.user or not sess.user.is_active:
        return None
    return sess


async def _touch_last_seen(db: AsyncSession, user: User) -> None:
    now = datetime.now(timezone.utc)
    prev = user.last_seen_at
    if prev is not None:
        prev_aware = prev if prev.tzinfo else prev.replace(tzinfo=timezone.utc)
        if now - prev_aware < timedelta(seconds=_SEEN_TOUCH_SECONDS):
            return
    user.last_seen_at = now
    await db.commit()


async def get_optional_user(
    request: Request, db: AsyncSession = Depends(get_db)
) -> User | None:
    sess = await _load_session(request, db)
    if sess is None:
        return None
    await _touch_last_seen(db, sess.user)
    return sess.user


async def require_user(user: User | None = Depends(get_optional_user)) -> User:
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


async def require_verified_user(user: User = Depends(require_user)) -> User:
    if user.email_verified_at is None:
        raise HTTPException(status_code=403, detail={"code": "email_not_verified"})
    return user
