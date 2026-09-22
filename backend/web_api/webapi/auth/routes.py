"""Auth HTTP routes."""
from __future__ import annotations

import logging
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile
from fastapi.responses import JSONResponse
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from .config import load_auth_settings
from .db import get_db
from .deps import get_optional_user, require_user
from .email import send_password_reset_email, send_verification_email
from .models import EmailVerificationToken, PasswordResetToken, Session, User
from .schemas import (
    ForgotPasswordIn,
    LoginIn,
    MeOut,
    ProfileUpdateIn,
    RegisterIn,
    ResendIn,
    ResetPasswordIn,
    UserOut,
    VerifyIn,
)
from .security import hash_password, hash_token, new_token, verify_password

logger = logging.getLogger("webapi.auth")
router = APIRouter(prefix="/api/auth", tags=["auth"])

_USERNAME_RE = re.compile(r"^[a-zA-Z0-9_]{3,32}$")
_AVATAR_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}
_MAX_AVATAR_BYTES = 2 * 1024 * 1024


def avatar_dir() -> Path:
    # backend/uploads/avatars
    root = Path(__file__).resolve().parents[3] / "uploads" / "avatars"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _avatar_url(user: User) -> str | None:
    if not user.avatar_path:
        return None
    return f"/uploads/{user.avatar_path.lstrip('/')}"


def _user_out(user: User) -> UserOut:
    return UserOut(
        id=user.id,
        email=user.email,
        role=user.role,
        email_verified=user.email_verified_at is not None,
        full_name=user.full_name,
        username=user.username,
        avatar_url=_avatar_url(user),
        created_at=user.created_at,
    )


def _set_session_cookie(response: Response, raw_token: str) -> None:
    settings = load_auth_settings()
    response.set_cookie(
        key=settings.cookie_name,
        value=raw_token,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        max_age=settings.session_ttl_days * 86400,
        path="/",
    )


def _clear_session_cookie(response: Response) -> None:
    settings = load_auth_settings()
    response.delete_cookie(settings.cookie_name, path="/")


def _delete_avatar_file(user: User) -> None:
    if not user.avatar_path:
        return
    path = Path(__file__).resolve().parents[3] / "uploads" / user.avatar_path
    try:
        if path.is_file():
            path.unlink()
    except OSError:
        logger.warning("Failed to delete avatar file %s", path)


async def _create_session(db: AsyncSession, user: User, request: Request) -> str:
    settings = load_auth_settings()
    raw = new_token(32)
    sess = Session(
        user_id=user.id,
        token_hash=hash_token(raw),
        expires_at=datetime.now(timezone.utc) + timedelta(days=settings.session_ttl_days),
        user_agent=(request.headers.get("user-agent") or "")[:512] or None,
        ip=request.client.host if request.client else None,
    )
    db.add(sess)
    user.last_login_at = datetime.now(timezone.utc)
    user.last_seen_at = user.last_login_at
    await db.commit()
    return raw


async def _issue_verification(db: AsyncSession, user: User) -> str:
    settings = load_auth_settings()
    await db.execute(
        update(EmailVerificationToken)
        .where(
            EmailVerificationToken.user_id == user.id,
            EmailVerificationToken.used_at.is_(None),
        )
        .values(used_at=datetime.now(timezone.utc))
    )
    raw = new_token(32)
    db.add(
        EmailVerificationToken(
            user_id=user.id,
            token_hash=hash_token(raw),
            expires_at=datetime.now(timezone.utc) + timedelta(hours=settings.verify_token_hours),
        )
    )
    await db.commit()
    return raw


async def _issue_password_reset(db: AsyncSession, user: User) -> str:
    settings = load_auth_settings()
    await db.execute(
        update(PasswordResetToken)
        .where(
            PasswordResetToken.user_id == user.id,
            PasswordResetToken.used_at.is_(None),
        )
        .values(used_at=datetime.now(timezone.utc))
    )
    raw = new_token(32)
    db.add(
        PasswordResetToken(
            user_id=user.id,
            token_hash=hash_token(raw),
            expires_at=datetime.now(timezone.utc) + timedelta(hours=settings.reset_token_hours),
        )
    )
    await db.commit()
    return raw


async def _revoke_user_sessions(db: AsyncSession, user_id: uuid.UUID) -> None:
    now = datetime.now(timezone.utc)
    sessions = (
        await db.execute(select(Session).where(Session.user_id == user_id, Session.revoked_at.is_(None)))
    ).scalars().all()
    for sess in sessions:
        sess.revoked_at = now


@router.get("/me", response_model=MeOut)
async def me(user: User | None = Depends(get_optional_user)):
    settings = load_auth_settings()
    return MeOut(
        user=_user_out(user) if user else None,
        auth_required=settings.auth_required,
    )


@router.patch("/profile", response_model=UserOut)
async def update_profile(
    body: ProfileUpdateIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_user),
):
    if (
        body.full_name is None
        and body.username is None
        and body.email is None
        and body.password is None
    ):
        raise HTTPException(status_code=400, detail="Nothing to update")

    needs_password = body.email is not None or body.password is not None
    if needs_password:
        if not body.current_password or not verify_password(user.password_hash, body.current_password):
            raise HTTPException(status_code=400, detail="Current password is required")

    if body.full_name is not None:
        name = body.full_name.strip()
        user.full_name = name or None

    if body.username is not None:
        username = body.username.strip()
        if username == "":
            user.username = None
        else:
            if not _USERNAME_RE.match(username):
                raise HTTPException(
                    status_code=400,
                    detail="Username must be 3–32 characters (letters, numbers, underscore)",
                )
            existing = await db.execute(
                select(User).where(User.username == username, User.id != user.id)
            )
            if existing.scalar_one_or_none():
                raise HTTPException(status_code=409, detail="Username already taken")
            user.username = username

    if body.email is not None:
        email = body.email.lower().strip()
        if email != user.email:
            existing = await db.execute(select(User).where(User.email == email))
            if existing.scalar_one_or_none():
                raise HTTPException(status_code=409, detail="Email already registered")
            user.email = email

    if body.password is not None:
        user.password_hash = hash_password(body.password)
        await _revoke_user_sessions(db, user.id)

    await db.commit()
    await db.refresh(user)
    return _user_out(user)


@router.post("/avatar", response_model=UserOut)
async def upload_avatar(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_user),
):
    content_type = (file.content_type or "").split(";")[0].strip().lower()
    ext = _AVATAR_TYPES.get(content_type)
    if not ext:
        raise HTTPException(status_code=400, detail="Avatar must be JPEG, PNG, WebP, or GIF")

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(data) > _MAX_AVATAR_BYTES:
        raise HTTPException(status_code=400, detail="Avatar must be 2MB or smaller")

    _delete_avatar_file(user)
    filename = f"{user.id}-{uuid.uuid4().hex[:8]}{ext}"
    dest = avatar_dir() / filename
    dest.write_bytes(data)
    user.avatar_path = f"avatars/{filename}"
    await db.commit()
    await db.refresh(user)
    return _user_out(user)


@router.delete("/avatar", response_model=UserOut)
async def delete_avatar(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_user),
):
    _delete_avatar_file(user)
    user.avatar_path = None
    await db.commit()
    await db.refresh(user)
    return _user_out(user)


@router.post("/register")
async def register(body: RegisterIn, request: Request, db: AsyncSession = Depends(get_db)):
    email = body.email.lower().strip()
    existing = await db.execute(select(User).where(User.email == email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Email already registered")

    user = User(email=email, password_hash=hash_password(body.password), role="user")
    db.add(user)
    await db.commit()
    await db.refresh(user)

    raw = await _issue_verification(db, user)
    settings = load_auth_settings()
    verify_url = f"{settings.app_public_url}/verify-email?token={raw}"
    email_sent = False
    try:
        await send_verification_email(email, verify_url)
        email_sent = True
        message = "Your account has been created. Check your email to complete verification."
    except Exception as e:
        logger.exception("Verification email failed for %s", email)
        detail = str(e) if str(e) else "email provider error"
        message = (
            "Account created, but the verification email failed to send. "
            f"Use the link below or try resend. ({detail})"
        )

    token = await _create_session(db, user, request)
    payload: dict = {
        "ok": True,
        "email": email,
        "email_sent": email_sent,
        "message": message,
    }
    # Always expose the link when send fails so signup is not blocked by SMTP.
    if settings.expose_email_urls or not email_sent:
        payload["verify_url"] = verify_url
        logger.info("Verify URL for %s: %s (email_sent=%s)", email, verify_url, email_sent)
    resp = JSONResponse(payload)
    _set_session_cookie(resp, token)
    return resp


@router.post("/login")
async def login(body: LoginIn, request: Request, response: Response, db: AsyncSession = Depends(get_db)):
    email = body.email.lower().strip()
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if user is None or not verify_password(user.password_hash, body.password):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account disabled")

    token = await _create_session(db, user, request)
    _set_session_cookie(response, token)
    return {
        "ok": True,
        "user": _user_out(user),
        "email_verified": user.email_verified_at is not None,
    }


@router.post("/logout")
async def logout(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(get_optional_user),
):
    settings = load_auth_settings()
    raw = request.cookies.get(settings.cookie_name)
    if raw:
        token_hash = hash_token(raw)
        result = await db.execute(select(Session).where(Session.token_hash == token_hash))
        sess = result.scalar_one_or_none()
        if sess and sess.revoked_at is None:
            sess.revoked_at = datetime.now(timezone.utc)
            await db.commit()
    _clear_session_cookie(response)
    return {"ok": True}


@router.post("/resend-verification")
async def resend_verification(body: ResendIn, db: AsyncSession = Depends(get_db)):
    email = body.email.lower().strip()
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if user and user.email_verified_at is None and user.is_active:
        raw = await _issue_verification(db, user)
        settings = load_auth_settings()
        verify_url = f"{settings.app_public_url}/verify-email?token={raw}"
        email_sent = False
        try:
            await send_verification_email(email, verify_url)
            email_sent = True
            message = "If that account needs verification, an email was sent."
        except Exception as e:
            logger.exception("Resend verification failed for %s", email)
            message = f"Could not send the email. Use the verification link below. ({e})"
        payload: dict = {
            "ok": True,
            "email_sent": email_sent,
            "message": message,
        }
        if settings.expose_email_urls or not email_sent:
            payload["verify_url"] = verify_url
            logger.info("Verify URL for %s: %s (email_sent=%s)", email, verify_url, email_sent)
        return payload
    return {
        "ok": True,
        "email_sent": False,
        "message": "If that account needs verification, an email was sent.",
    }


@router.post("/verify-email")
async def verify_email(
    body: VerifyIn,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    token_hash = hash_token(body.token.strip())
    result = await db.execute(
        select(EmailVerificationToken).where(EmailVerificationToken.token_hash == token_hash)
    )
    row = result.scalar_one_or_none()
    now = datetime.now(timezone.utc)
    if row is None or row.used_at is not None:
        raise HTTPException(status_code=400, detail="Invalid or used verification token")
    exp = row.expires_at if row.expires_at.tzinfo else row.expires_at.replace(tzinfo=timezone.utc)
    if exp < now:
        raise HTTPException(status_code=400, detail="Verification token expired")

    user = await db.get(User, row.user_id)
    if user is None or not user.is_active:
        raise HTTPException(status_code=400, detail="Invalid verification token")

    row.used_at = now
    user.email_verified_at = now
    await db.commit()

    token = await _create_session(db, user, request)
    _set_session_cookie(response, token)
    return {"ok": True, "user": _user_out(user)}


@router.post("/forgot-password")
async def forgot_password(body: ForgotPasswordIn, db: AsyncSession = Depends(get_db)):
    """Always returns ok to avoid email enumeration."""
    email = body.email.lower().strip()
    generic = {
        "ok": True,
        "email_sent": False,
        "message": "If that email is registered, a reset link was sent.",
    }
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        return generic

    raw = await _issue_password_reset(db, user)
    settings = load_auth_settings()
    reset_url = f"{settings.app_public_url}/reset-password?token={raw}"
    email_sent = False
    try:
        await send_password_reset_email(email, reset_url)
        email_sent = True
        message = "If that email is registered, a reset link was sent."
    except Exception as e:
        logger.exception("Password reset email failed for %s", email)
        message = f"Could not send the email. Use the reset link below. ({e})"

    payload: dict = {
        "ok": True,
        "email_sent": email_sent,
        "message": message,
    }
    if settings.expose_email_urls or not email_sent:
        payload["reset_url"] = reset_url
        logger.info("Reset URL for %s: %s (email_sent=%s)", email, reset_url, email_sent)
    return payload


@router.post("/reset-password")
async def reset_password(
    body: ResetPasswordIn,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    token_hash = hash_token(body.token.strip())
    result = await db.execute(
        select(PasswordResetToken).where(PasswordResetToken.token_hash == token_hash)
    )
    row = result.scalar_one_or_none()
    now = datetime.now(timezone.utc)
    if row is None or row.used_at is not None:
        raise HTTPException(status_code=400, detail="Invalid or used reset token")
    exp = row.expires_at if row.expires_at.tzinfo else row.expires_at.replace(tzinfo=timezone.utc)
    if exp < now:
        raise HTTPException(status_code=400, detail="Reset token expired")

    user = await db.get(User, row.user_id)
    if user is None or not user.is_active:
        raise HTTPException(status_code=400, detail="Invalid reset token")

    row.used_at = now
    user.password_hash = hash_password(body.password)
    await _revoke_user_sessions(db, user.id)
    await db.commit()

    token = await _create_session(db, user, request)
    _set_session_cookie(response, token)
    return {
        "ok": True,
        "user": _user_out(user),
        "email_verified": user.email_verified_at is not None,
    }


@router.get("/csrf")
async def csrf(response: Response):
    """Issue a readable CSRF cookie for future state-changing forms."""
    settings = load_auth_settings()
    token = secrets.token_urlsafe(24)
    response.set_cookie(
        key=settings.csrf_cookie_name,
        value=token,
        httponly=False,
        secure=settings.cookie_secure,
        samesite="lax",
        max_age=86400,
        path="/",
    )
    return {"csrf_token": token}
