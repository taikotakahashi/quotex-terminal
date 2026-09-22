"""Test SMTP login using backend/.env (does not print the password)."""
from __future__ import annotations

import ssl
import smtplib
import sys
from pathlib import Path


def load_env(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        k = k.strip()
        v = v.strip()
        if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
            v = v[1:-1]
        env[k] = v
    return env


def main() -> int:
    env_path = Path(__file__).resolve().parents[1] / ".env"
    if not env_path.exists():
        print(f"Missing {env_path}")
        return 1
    env = load_env(env_path)
    host = env.get("SMTP_HOST", "")
    port = int(env.get("SMTP_PORT", "465"))
    user = env.get("SMTP_USER", "")
    password = env.get("SMTP_PASSWORD", "")
    tls = env.get("SMTP_TLS", "false").lower() in ("1", "true", "yes", "on")
    print(f"Testing SMTP host={host} port={port} user={user} tls={tls} password_len={len(password)}")
    if not host or not user or not password:
        print("FAIL: SMTP_HOST / SMTP_USER / SMTP_PASSWORD must be set")
        return 1
    try:
        if port == 465 or not tls:
            with smtplib.SMTP_SSL(host, port, timeout=25, context=ssl.create_default_context()) as smtp:
                smtp.ehlo()
                smtp.login(user, password)
        else:
            with smtplib.SMTP(host, port, timeout=25) as smtp:
                smtp.ehlo()
                smtp.starttls(context=ssl.create_default_context())
                smtp.ehlo()
                smtp.login(user, password)
        print("OK: SMTP login succeeded")
        return 0
    except smtplib.SMTPAuthenticationError as e:
        print(f"FAIL: authentication rejected ({e})")
        print("Titan checklist:")
        print("  1) Open https://app.titan.email/mail/ as noreply@…")
        print("  2) Settings → Enable Titan on other apps")
        print("  3) Disable 2FA on that mailbox (2FA blocks SMTP)")
        print("  4) Reset mailbox password and put it in SMTP_PASSWORD with no quotes")
        print("  5) Restart make api, then run: make smtp-test")
        return 2
    except Exception as e:
        print(f"FAIL: {type(e).__name__}: {e}")
        return 3


if __name__ == "__main__":
    sys.exit(main())
