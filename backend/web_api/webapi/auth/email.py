"""Transactional email over SMTP (Titan / Mailpit / any SMTP server)."""
from __future__ import annotations

import asyncio
import html as html_lib
import logging
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import parseaddr

from .config import load_auth_settings

logger = logging.getLogger("webapi.auth.email")

# Brand colors aligned with the Quotex dashboard (teal / dark navy).
_BRAND = "#0eb67a"
_BRAND_DARK = "#0a8f60"
_INK = "#0f172a"
_MUTED = "#64748b"
_BG = "#eef2f6"
_CARD = "#ffffff"


def _make_message(to_email: str, from_addr: str, subject: str, text: str, html: str) -> EmailMessage:
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = to_email
    msg.set_content(text)
    msg.add_alternative(html, subtype="html")
    return msg


def _email_shell(
    *,
    preheader: str,
    title: str,
    body_html: str,
    cta_label: str,
    cta_url: str,
    footer_note: str,
) -> str:
    """Responsive, Gmail-safe HTML layout (tables + inline styles)."""
    safe_url = html_lib.escape(cta_url, quote=True)
    safe_title = html_lib.escape(title)
    safe_pre = html_lib.escape(preheader)
    safe_cta = html_lib.escape(cta_label)
    safe_footer = html_lib.escape(footer_note)

    return f"""\
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <title>{safe_title}</title>
</head>
<body style="margin:0;padding:0;background:{_BG};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
    {safe_pre}
  </div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
         style="background:{_BG};margin:0;padding:0;width:100%;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
               style="max-width:520px;width:100%;">
          <!-- Brand bar -->
          <tr>
            <td style="padding:0 0 16px 0;text-align:center;">
              <span style="font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:800;
                           letter-spacing:2.2px;color:{_BRAND_DARK};text-transform:uppercase;">
                Quotex Signals
              </span>
            </td>
          </tr>
          <!-- Card -->
          <tr>
            <td style="background:{_CARD};border-radius:14px;overflow:hidden;
                       box-shadow:0 8px 28px rgba(15,23,42,0.08);">
              <!-- Accent strip -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="height:4px;line-height:4px;font-size:0;background:linear-gradient(90deg,{_BRAND},{_BRAND_DARK});
                             background-color:{_BRAND};">&nbsp;</td>
                </tr>
              </table>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:36px 32px 28px 32px;font-family:Arial,Helvetica,sans-serif;color:{_INK};">
                    <h1 style="margin:0 0 12px 0;font-size:24px;line-height:1.25;font-weight:700;
                               letter-spacing:-0.3px;color:{_INK};">
                      {safe_title}
                    </h1>
                    <div style="margin:0 0 28px 0;font-size:15px;line-height:1.6;color:{_MUTED};">
                      {body_html}
                    </div>
                    <!-- CTA -->
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 8px auto;">
                      <tr>
                        <td align="center" bgcolor="{_BRAND}" style="border-radius:10px;background:{_BRAND};">
                          <a href="{safe_url}"
                             style="display:inline-block;padding:14px 28px;font-family:Arial,Helvetica,sans-serif;
                                    font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;
                                    border-radius:10px;letter-spacing:0.2px;">
                            {safe_cta}
                          </a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              <!-- Footer inside card -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:0 32px 28px 32px;font-family:Arial,Helvetica,sans-serif;
                             font-size:12px;line-height:1.5;color:{_MUTED};border-top:1px solid #eef2f6;">
                    <p style="margin:18px 0 0 0;">{safe_footer}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Outer footer -->
          <tr>
            <td style="padding:20px 8px 0 8px;text-align:center;font-family:Arial,Helvetica,sans-serif;
                       font-size:11px;line-height:1.5;color:#94a3b8;">
              Live market signals · Practice mode · No auto-trade
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
"""


def _verification_copy(verify_url: str) -> tuple[str, str, str]:
    subject = "Verify your Quotex Signals account"
    body = (
        '<p style="margin:0 0 12px 0;">Thanks for registering with '
        "<strong style=\"color:#0f172a;\">Quotex Signals</strong>.</p>"
        '<p style="margin:0;">Confirm your email address to activate your account '
        "and start receiving live signals.</p>"
    )
    html = _email_shell(
        preheader="Confirm your email to activate your Quotex Signals account.",
        title="Confirm your email",
        body_html=body,
        cta_label="Verify email",
        cta_url=verify_url,
        footer_note="If you did not create an account, you can safely ignore this email.",
    )
    text = (
        "Confirm your email — Quotex Signals\n\n"
        "Thanks for registering. Open this link to verify your account:\n"
        f"{verify_url}\n\n"
        "If you did not create an account, you can ignore this email.\n"
    )
    return subject, text, html


def _reset_copy(reset_url: str) -> tuple[str, str, str]:
    subject = "Reset your Quotex Signals password"
    body = (
        '<p style="margin:0 0 12px 0;">We received a request to reset the password '
        "for your Quotex Signals account.</p>"
        '<p style="margin:0;">Click the button below to choose a new password. '
        "This link expires soon.</p>"
    )
    html = _email_shell(
        preheader="Reset your Quotex Signals password.",
        title="Reset your password",
        body_html=body,
        cta_label="Reset password",
        cta_url=reset_url,
        footer_note="If you did not ask for a reset, you can ignore this email. Your password will stay the same.",
    )
    text = (
        "Reset your Quotex Signals password\n\n"
        "Open this link to choose a new password:\n"
        f"{reset_url}\n\n"
        "If you did not ask for a reset, you can ignore this email.\n"
    )
    return subject, text, html


def _send_smtp(to_email: str, subject: str, text: str, html: str) -> None:
    settings = load_auth_settings()
    if not settings.smtp_host:
        raise RuntimeError("SMTP_HOST is not configured")
    if settings.smtp_user and not settings.smtp_password:
        raise RuntimeError("SMTP_PASSWORD is empty — set the mailbox password in backend/.env")

    msg = _make_message(to_email, settings.email_from, subject, text, html)
    _, envelope_from = parseaddr(settings.email_from)
    if not envelope_from:
        envelope_from = settings.smtp_user or settings.email_from

    ctx = ssl.create_default_context()
    port = settings.smtp_port
    use_ssl = port == 465

    try:
        if use_ssl:
            with smtplib.SMTP_SSL(settings.smtp_host, port, timeout=25, context=ctx) as smtp:
                smtp.ehlo()
                if settings.smtp_user:
                    smtp.login(settings.smtp_user, settings.smtp_password)
                smtp.send_message(msg, from_addr=envelope_from, to_addrs=[to_email])
        else:
            with smtplib.SMTP(settings.smtp_host, port, timeout=25) as smtp:
                smtp.ehlo()
                if settings.smtp_tls:
                    smtp.starttls(context=ctx)
                    smtp.ehlo()
                if settings.smtp_user:
                    smtp.login(settings.smtp_user, settings.smtp_password)
                smtp.send_message(msg, from_addr=envelope_from, to_addrs=[to_email])
    except smtplib.SMTPAuthenticationError as e:
        logger.error(
            "SMTP auth failed for user=%s host=%s:%s",
            settings.smtp_user,
            settings.smtp_host,
            settings.smtp_port,
        )
        raise RuntimeError(
            "Email server rejected login (SMTP 535). Check SMTP_USER / SMTP_PASSWORD in backend/.env, "
            "then restart the API."
        ) from e
    except OSError as e:
        logger.error("SMTP connection failed host=%s:%s err=%s", settings.smtp_host, settings.smtp_port, e)
        raise RuntimeError(f"Cannot reach mail server {settings.smtp_host}:{settings.smtp_port}") from e

    logger.info("Email sent via SMTP to %s subject=%s", to_email, subject)


async def send_verification_email(to_email: str, verify_url: str) -> None:
    subject, text, html = _verification_copy(verify_url)
    await asyncio.to_thread(_send_smtp, to_email, subject, text, html)


async def send_password_reset_email(to_email: str, reset_url: str) -> None:
    subject, text, html = _reset_copy(reset_url)
    await asyncio.to_thread(_send_smtp, to_email, subject, text, html)
