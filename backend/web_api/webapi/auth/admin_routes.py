"""Admin-only HTTP routes."""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .db import get_db
from .deps import require_verified_user
from .models import Session as AuthSession
from .models import User
from .security import hash_password

router = APIRouter(prefix="/api/admin", tags=["admin"])

# Consider a user online if seen within this window.
ONLINE_WINDOW_SECONDS = 5 * 60


async def _revoke_user_sessions(db: AsyncSession, user_id: UUID) -> None:
    """Invalidate every active browser session for this user (forces logout)."""
    now = datetime.now(timezone.utc)
    sessions = (
        await db.execute(
            select(AuthSession).where(AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None))
        )
    ).scalars().all()
    for sess in sessions:
        sess.revoked_at = now


class AdminUserOut(BaseModel):
    id: UUID
    email: str
    role: str
    is_active: bool
    email_verified: bool
    is_online: bool = False
    full_name: str | None = None
    username: str | None = None
    avatar_url: str | None = None
    created_at: datetime | None = None
    last_login_at: datetime | None = None
    last_seen_at: datetime | None = None


class AdminStatsOut(BaseModel):
    total_users: int
    verified_users: int
    online_users: int
    admin_users: int


class AdminUsersOut(BaseModel):
    stats: AdminStatsOut
    users: list[AdminUserOut]


class AdminUserPatch(BaseModel):
    role: str | None = Field(default=None, pattern="^(user|admin)$")
    is_active: bool | None = None
    email: EmailStr | None = None
    password: str | None = Field(default=None, min_length=8, max_length=128)
    email_verified: bool | None = None


class AdminUserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    role: str = Field(default="user", pattern="^(user|admin)$")
    email_verified: bool = True


async def require_admin(user: User = Depends(require_verified_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    return user


def _is_online(u: User, now: datetime | None = None) -> bool:
    if not u.is_active:
        return False
    stamp = u.last_seen_at or u.last_login_at
    if stamp is None:
        return False
    now = now or datetime.now(timezone.utc)
    aware = stamp if stamp.tzinfo else stamp.replace(tzinfo=timezone.utc)
    return (now - aware).total_seconds() <= ONLINE_WINDOW_SECONDS


def _admin_user_out(u: User) -> AdminUserOut:
    avatar_url = f"/uploads/{u.avatar_path.lstrip('/')}" if u.avatar_path else None
    return AdminUserOut(
        id=u.id,
        email=u.email,
        role=u.role,
        is_active=u.is_active,
        email_verified=u.email_verified_at is not None,
        is_online=_is_online(u),
        full_name=u.full_name,
        username=u.username,
        avatar_url=avatar_url,
        created_at=u.created_at,
        last_login_at=u.last_login_at,
        last_seen_at=u.last_seen_at,
    )


async def _count_other_active_admins(db: AsyncSession, exclude_id: UUID) -> int:
    result = await db.execute(
        select(func.count())
        .select_from(User)
        .where(User.role == "admin", User.is_active.is_(True), User.id != exclude_id)
    )
    return int(result.scalar_one() or 0)


@router.get("/users", response_model=AdminUsersOut)
async def list_users(
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    result = await db.execute(select(User).order_by(User.created_at.desc()))
    users = list(result.scalars().all())
    total = len(users)
    verified = sum(1 for u in users if u.email_verified_at is not None)
    online = sum(1 for u in users if _is_online(u))
    admins = sum(1 for u in users if u.role == "admin")
    return AdminUsersOut(
        stats=AdminStatsOut(
            total_users=total,
            verified_users=verified,
            online_users=online,
            admin_users=admins,
        ),
        users=[_admin_user_out(u) for u in users],
    )


@router.post("/users", response_model=AdminUserOut)
async def create_user(
    body: AdminUserCreate,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    email = body.email.lower().strip()
    existing = await db.execute(select(User).where(User.email == email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Email already registered")

    now = datetime.now(timezone.utc)
    user = User(
        email=email,
        password_hash=hash_password(body.password),
        role=body.role,
        email_verified_at=now if body.email_verified else None,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return _admin_user_out(user)


@router.patch("/users/{user_id}", response_model=AdminUserOut)
async def patch_user(
    user_id: UUID,
    body: AdminUserPatch,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    if (
        body.role is None
        and body.is_active is None
        and body.email is None
        and body.password is None
        and body.email_verified is None
    ):
        raise HTTPException(status_code=400, detail="Nothing to update")

    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    if user.id == admin.id:
        if body.role == "user":
            raise HTTPException(status_code=400, detail="Cannot demote your own admin account")
        if body.is_active is False:
            raise HTTPException(status_code=400, detail="Cannot deactivate your own account")

    next_role = body.role if body.role is not None else user.role
    next_active = body.is_active if body.is_active is not None else user.is_active
    was_active_admin = user.role == "admin" and user.is_active
    stays_active_admin = next_role == "admin" and next_active
    if was_active_admin and not stays_active_admin:
        if await _count_other_active_admins(db, user.id) == 0:
            raise HTTPException(status_code=400, detail="Cannot remove the last active admin")

    if body.email is not None:
        email = body.email.lower().strip()
        if email != user.email:
            existing = await db.execute(select(User).where(User.email == email))
            if existing.scalar_one_or_none():
                raise HTTPException(status_code=409, detail="Email already registered")
            user.email = email

    if body.password is not None:
        user.password_hash = hash_password(body.password)

    if body.email_verified is not None:
        user.email_verified_at = datetime.now(timezone.utc) if body.email_verified else None

    if body.role is not None:
        user.role = body.role
    if body.is_active is not None:
        user.is_active = body.is_active

    # Force logout when credentials change or the account is disabled.
    if body.password is not None or body.is_active is False:
        await _revoke_user_sessions(db, user.id)

    await db.commit()
    await db.refresh(user)
    return _admin_user_out(user)


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: UUID,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_admin),
):
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == admin.id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    if user.role == "admin" and user.is_active:
        if await _count_other_active_admins(db, user.id) == 0:
            raise HTTPException(status_code=400, detail="Cannot delete the last active admin")

    await _revoke_user_sessions(db, user.id)
    await db.delete(user)
    await db.commit()
    return {"ok": True}
