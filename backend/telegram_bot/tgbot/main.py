"""Telegram notification worker.

- Redeems website deep-link tokens (`/start link_<token>`)
- Pushes feed.signal.* / feed.signal_result.* to linked chats

Run: quotex-telegram   (or: python -m tgbot.main)
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
import time
from typing import Any

import redis.asyncio as aioredis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import selectinload

from .config import BotSettings, load_settings
from .filters import should_send_result, should_send_signal
from .messages import (
    format_result,
    format_signal,
    language_keyboard,
    market_keyboard,
    market_pref_label,
    site_keyboard,
    t,
    timeframe_keyboard,
    tf_pref_label,
    with_site_link,
)
from .telegram_api import TelegramApi, TelegramConflictError

logger = logging.getLogger("tgbot")


def _setup_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    # httpx logs full request URLs, which include the bot token.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)


class BotApp:
    def __init__(self, settings: BotSettings):
        self.settings = settings
        self.api = TelegramApi(settings.bot_token)
        self.engine = create_async_engine(settings.database_url, pool_pre_ping=True)
        self.Session = async_sessionmaker(self.engine, class_=AsyncSession, expire_on_commit=False)
        self.redis = aioredis.from_url(settings.redis_url, decode_responses=True)
        self._offset: int | None = None
        self._category_cache: dict[str, str] = {}
        self._payout_cache: dict[str, float] = {}
        self._name_cache: dict[str, str] = {}
        self._catalog_loaded_at = 0.0
        self._instance_id = f"{os.getpid()}-{int(time.time())}"
        self._lock_key = "tg:bot:poller_lock"
        self._lock_ttl = 45
        self._hold_lock = False

    async def close(self) -> None:
        if self._hold_lock:
            try:
                cur = await self.redis.get(self._lock_key)
                if cur == self._instance_id:
                    await self.redis.delete(self._lock_key)
            except Exception:
                logger.exception("Failed releasing poller lock")
        await self.api.close()
        await self.redis.aclose()
        await self.engine.dispose()

    async def acquire_poller_lock(self) -> bool:
        """Only one process may long-poll Telegram for this bot token."""
        ok = await self.redis.set(self._lock_key, self._instance_id, nx=True, ex=self._lock_ttl)
        if ok:
            self._hold_lock = True
            return True
        holder = await self.redis.get(self._lock_key)
        # Steal lock if previous holder PID is gone (crash / kill -9 left a stale key).
        if holder and self._holder_pid_dead(holder):
            await self.redis.delete(self._lock_key)
            ok = await self.redis.set(self._lock_key, self._instance_id, nx=True, ex=self._lock_ttl)
            if ok:
                logger.warning("Took over stale poller lock from dead holder %s", holder)
                self._hold_lock = True
                return True
        logger.error(
            "Another telegram bot instance already holds the poller lock (%s). "
            "Stop the other `make telegram` / systemd unit and retry.",
            holder or "unknown",
        )
        return False

    @staticmethod
    def _holder_pid_dead(holder: str) -> bool:
        try:
            pid_s = str(holder).split("-", 1)[0]
            pid = int(pid_s)
        except (TypeError, ValueError):
            return False
        if pid <= 1:
            return False
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return True
        except PermissionError:
            return False
        return False

    async def renew_poller_lock(self) -> bool:
        if not self._hold_lock:
            return False
        cur = await self.redis.get(self._lock_key)
        if cur != self._instance_id:
            self._hold_lock = False
            return False
        await self.redis.expire(self._lock_key, self._lock_ttl)
        return True

    async def refresh_catalog(self, force: bool = False) -> None:
        if not force and time.time() - self._catalog_loaded_at < 60:
            return
        raw = await self.redis.get("feed:assets")
        if not raw:
            return
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            return
        assets = data.get("assets") if isinstance(data, dict) else data
        if not isinstance(assets, list):
            return
        cats: dict[str, str] = {}
        pays: dict[str, float] = {}
        names: dict[str, str] = {}
        for a in assets:
            if not isinstance(a, dict):
                continue
            sym = str(a.get("symbol") or a.get("code") or "")
            if not sym:
                continue
            cat = str(a.get("category") or "")
            if cat:
                cats[sym] = cat
            name = str(a.get("name") or "").strip()
            if name:
                names[sym] = name
            payout = a.get("payout", a.get("turbo_payout"))
            try:
                pays[sym] = float(payout)
            except (TypeError, ValueError):
                pass
        self._category_cache = cats
        self._payout_cache = pays
        self._name_cache = names
        self._catalog_loaded_at = time.time()

    async def _session(self) -> AsyncSession:
        return self.Session()

    async def get_link_by_chat(self, chat_id: int):
        from webapi.auth.models import TelegramLink, User

        async with self.Session() as db:
            result = await db.execute(
                select(TelegramLink)
                .where(TelegramLink.chat_id == chat_id)
                .options(selectinload(TelegramLink.user))
            )
            return result.scalar_one_or_none()

    async def set_enabled(self, chat_id: int, enabled: bool) -> bool:
        from webapi.auth.models import TelegramLink
        from webapi.telegram_prefs import normalize_prefs, prefs_ready_for_alerts

        async with self.Session() as db:
            result = await db.execute(select(TelegramLink).where(TelegramLink.chat_id == chat_id))
            link = result.scalar_one_or_none()
            if link is None:
                return False
            prefs = normalize_prefs(link.prefs if isinstance(link.prefs, dict) else None)
            if enabled and not prefs_ready_for_alerts(prefs):
                return False
            link.enabled = enabled
            await db.commit()
            return True

    async def update_prefs(self, chat_id: int, **patch: Any) -> dict[str, Any] | None:
        from webapi.auth.models import TelegramLink
        from webapi.telegram_prefs import normalize_prefs

        async with self.Session() as db:
            result = await db.execute(select(TelegramLink).where(TelegramLink.chat_id == chat_id))
            link = result.scalar_one_or_none()
            if link is None:
                return None
            prefs = normalize_prefs(link.prefs if isinstance(link.prefs, dict) else None)
            prefs.update(patch)
            prefs = normalize_prefs(prefs)
            link.prefs = prefs
            if prefs.get("setup_complete") and prefs.get("timeframes"):
                link.enabled = True
            await db.commit()
            return prefs

    async def list_enabled_links(self) -> list[dict[str, Any]]:
        from webapi.auth.models import TelegramLink, User
        from webapi.telegram_prefs import prefs_ready_for_alerts

        async with self.Session() as db:
            result = await db.execute(
                select(TelegramLink)
                .join(User, User.id == TelegramLink.user_id)
                .where(TelegramLink.enabled.is_(True))
                .where(User.is_active.is_(True))
                .where(User.email_verified_at.is_not(None))
            )
            rows = []
            for link in result.scalars().all():
                prefs = dict(link.prefs) if isinstance(link.prefs, dict) else {}
                if not prefs_ready_for_alerts(prefs):
                    continue
                rows.append(
                    {
                        "chat_id": int(link.chat_id),
                        "prefs": prefs,
                        "enabled": bool(link.enabled),
                    }
                )
            return rows

    async def redeem(self, raw_token: str, chat_id: int, username: str | None):
        from webapi.telegram_routes import redeem_link_token

        async with self.Session() as db:
            return await redeem_link_token(
                db, raw_token=raw_token, chat_id=chat_id, telegram_username=username
            )

    async def dedupe(self, key: str, ttl: int = 86400) -> bool:
        """Return True if this is the first time we see the key."""
        ok = await self.redis.set(f"tg:dedupe:{key}", "1", nx=True, ex=ttl)
        return bool(ok)

    def _lang_for_prefs(self, prefs: dict[str, Any] | None) -> str:
        prefs = prefs if isinstance(prefs, dict) else {}
        lang = str(prefs.get("lang") or self.settings.default_lang)
        return lang if lang in ("pt", "en", "es") else "pt"

    def _lang_for_link(self, link) -> str:
        prefs = link.prefs if isinstance(getattr(link, "prefs", None), dict) else {}
        return self._lang_for_prefs(prefs)

    def _default_lang(self) -> str:
        return self.settings.default_lang if self.settings.default_lang in ("pt", "en", "es") else "pt"

    async def send_with_site(self, chat_id: int, text: str, lang: str) -> None:
        url = self.settings.app_public_url
        markup = site_keyboard(url, lang)
        body = text if markup else with_site_link(text, url, lang)
        await self.api.send_message(chat_id, body, reply_markup=markup)

    async def prompt_language(self, chat_id: int, lang: str, *, preface: str | None = None) -> None:
        text = t(lang, "choose_lang")
        if preface:
            text = f"{preface}\n\n{text}"
        await self.api.send_message(chat_id, text, reply_markup=language_keyboard(lang))

    async def prompt_timeframe(self, chat_id: int, lang: str) -> None:
        await self.api.send_message(chat_id, t(lang, "choose_tf"), reply_markup=timeframe_keyboard(lang))

    async def prompt_market(self, chat_id: int, lang: str) -> None:
        await self.api.send_message(chat_id, t(lang, "choose_market"), reply_markup=market_keyboard(lang))

    async def handle_start(self, chat_id: int, username: str | None, payload: str | None) -> None:
        lang = self._default_lang()
        link = await self.get_link_by_chat(chat_id)
        if link is not None:
            lang = self._lang_for_link(link)

        if payload and payload.startswith("link_"):
            raw = payload[len("link_") :]
            try:
                await self.redeem(raw, chat_id, username)
            except ValueError as e:
                code = str(e)
                key = {
                    "invalid_token": "err_invalid",
                    "token_used": "err_used",
                    "token_expired": "err_expired",
                    "user_inactive": "err_inactive",
                    "email_not_verified": "err_inactive",
                }.get(code, "err_invalid")
                await self.send_with_site(chat_id, t(lang, key), lang)
                return
            # Fresh link: language → timeframe → market wizard before alerts.
            await self.prompt_language(chat_id, lang, preface=t(lang, "linked_ok"))
            return

        if link is not None:
            # Already linked: re-run setup so prefs can be changed.
            await self.prompt_language(chat_id, lang, preface=t(lang, "already_linked"))
            return

        await self.send_with_site(chat_id, t(lang, "welcome_unlinked"), lang)

    async def handle_callback(self, callback: dict) -> None:
        cb_id = str(callback.get("id") or "")
        data = str(callback.get("data") or "")
        msg = callback.get("message") or {}
        chat = msg.get("chat") or {}
        chat_id = chat.get("id")
        if chat_id is None:
            if cb_id:
                await self.api.answer_callback(cb_id)
            return
        chat_id = int(chat_id)
        link = await self.get_link_by_chat(chat_id)
        lang = self._lang_for_link(link) if link else self._default_lang()

        if link is None:
            await self.api.answer_callback(cb_id, t(lang, "not_linked")[:200])
            await self.send_with_site(chat_id, t(lang, "not_linked"), lang)
            return

        if data.startswith("setup:lang:"):
            chosen = data.split(":")[-1]
            if chosen not in ("en", "es", "pt"):
                await self.api.answer_callback(cb_id)
                return
            prefs = await self.update_prefs(chat_id, lang=chosen, setup_complete=False)
            lang = chosen if prefs else chosen
            await self.api.answer_callback(cb_id, t(lang, f"lang_label_{chosen}")[:200])
            await self.prompt_timeframe(chat_id, lang)
            return

        if data.startswith("setup:tf:"):
            token = data.split(":")[-1]
            if token == "all":
                tfs = [60, 300, 900]
            elif token in ("60", "300", "900"):
                tfs = [int(token)]
            else:
                await self.api.answer_callback(cb_id)
                return
            prefs = await self.update_prefs(
                chat_id,
                timeframes=tfs,
                setup_complete=False,
            )
            lang = self._lang_for_prefs(prefs) if prefs else lang
            label = tf_pref_label(lang, tfs)
            await self.api.answer_callback(cb_id, label[:200])
            await self.prompt_market(chat_id, lang)
            return

        if data.startswith("setup:market:"):
            token = data.split(":")[-1]
            if token == "all":
                markets: list[str] = []
            elif token in ("currency", "crypto", "commodity", "other"):
                markets = [token]
            else:
                await self.api.answer_callback(cb_id)
                return
            prefs = await self.update_prefs(
                chat_id,
                markets=markets,
                setup_complete=True,
            )
            lang = self._lang_for_prefs(prefs) if prefs else lang
            market_label = market_pref_label(lang, markets)
            tf_label = tf_pref_label(lang, list((prefs or {}).get("timeframes") or []))
            await self.api.answer_callback(cb_id, market_label[:200])
            await self.api.send_message(
                chat_id,
                t(
                    lang,
                    "setup_done",
                    lang_label=t(lang, f"lang_label_{lang}"),
                    tf_label=tf_label,
                    market_label=market_label,
                ),
            )
            return

        await self.api.answer_callback(cb_id)

    async def handle_command(self, chat_id: int, text: str) -> None:
        from webapi.telegram_prefs import normalize_prefs, prefs_ready_for_alerts

        cmd = text.split()[0].split("@")[0].lower()
        link = await self.get_link_by_chat(chat_id)
        lang = self._lang_for_link(link) if link else self._default_lang()

        if cmd == "/help":
            await self.api.send_message(chat_id, t(lang, "help"))
            return
        if cmd == "/on":
            if link is None:
                await self.send_with_site(chat_id, t(lang, "not_linked"), lang)
                return
            prefs = normalize_prefs(link.prefs if isinstance(link.prefs, dict) else None)
            if not prefs_ready_for_alerts(prefs):
                await self.prompt_language(chat_id, lang, preface=t(lang, "need_setup"))
                return
            if not await self.set_enabled(chat_id, True):
                await self.send_with_site(chat_id, t(lang, "not_linked"), lang)
                return
            await self.api.send_message(chat_id, t(lang, "enabled"))
            return
        if cmd == "/off":
            if not await self.set_enabled(chat_id, False):
                await self.send_with_site(chat_id, t(lang, "not_linked"), lang)
                return
            await self.api.send_message(chat_id, t(lang, "disabled"))
            return
        if cmd == "/status":
            if link is None:
                await self.send_with_site(chat_id, t(lang, "not_linked"), lang)
                return
            prefs = normalize_prefs(link.prefs if isinstance(link.prefs, dict) else None)
            if not prefs_ready_for_alerts(prefs):
                await self.prompt_language(chat_id, lang, preface=t(lang, "need_setup"))
                return
            state = t(lang, "status_on" if link.enabled else "status_off")
            tf_label = tf_pref_label(lang, list(prefs.get("timeframes") or []))
            market_label = market_pref_label(lang, list(prefs.get("markets") or []))
            await self.api.send_message(
                chat_id,
                t(
                    lang,
                    "status_linked",
                    state=state,
                    market_label=market_label,
                    tf_label=tf_label,
                ),
            )
            return

    async def process_update(self, update: dict) -> None:
        cb = update.get("callback_query")
        if cb:
            await self.handle_callback(cb)
            return

        msg = update.get("message") or update.get("edited_message")
        if not msg:
            return
        chat = msg.get("chat") or {}
        chat_id = chat.get("id")
        if chat_id is None:
            return
        from_user = msg.get("from") or {}
        username = from_user.get("username")
        text = (msg.get("text") or "").strip()
        if not text:
            return
        if text.startswith("/start"):
            parts = text.split(maxsplit=1)
            payload = parts[1].strip() if len(parts) > 1 else None
            await self.handle_start(int(chat_id), username, payload)
            return
        if text.startswith("/"):
            await self.handle_command(int(chat_id), text)

    async def poll_updates(self) -> None:
        logger.info("Telegram long-polling as @%s", self.settings.bot_username)
        conflict_streak = 0
        while True:
            if not await self.renew_poller_lock():
                logger.error("Lost poller lock — exiting so another instance can run cleanly")
                return
            try:
                updates = await self.api.get_updates(self._offset, timeout=25)
                conflict_streak = 0
            except TelegramConflictError as e:
                conflict_streak += 1
                if conflict_streak == 1 or conflict_streak % 10 == 0:
                    logger.warning(
                        "Telegram 409 Conflict (another getUpdates is running): %s — waiting",
                        e,
                    )
                await asyncio.sleep(5)
                continue
            except Exception:
                logger.exception("getUpdates failed; retrying")
                await asyncio.sleep(3)
                continue
            for upd in updates:
                uid = upd.get("update_id")
                if isinstance(uid, int):
                    self._offset = uid + 1
                try:
                    await self.process_update(upd)
                except Exception:
                    logger.exception("Failed processing update %s", uid)

    async def on_signal(self, payload: dict[str, Any]) -> None:
        asset = str(payload.get("asset") or "")
        tf = int(payload.get("timeframe") or 0)
        direction = str(payload.get("direction") or "")
        entry = int(payload.get("entry_start") or 0)
        dedupe_key = f"signal:{asset}:{tf}:{entry}:{direction}"
        if not await self.dedupe(dedupe_key):
            return
        await self.refresh_catalog()
        category = self._category_cache.get(asset)
        payout = self._payout_cache.get(asset)
        conf = float(payload.get("confidence") or 0)
        links = await self.list_enabled_links()
        now = time.time()
        for link in links:
            if not should_send_signal(
                link["prefs"],
                enabled=True,
                timeframe=tf,
                category=category,
                confidence=conf,
                payout=payout,
            ):
                continue
            lang = self._lang_for_prefs(link["prefs"])
            text = format_signal(
                lang,
                payload,
                payout=payout,
                now=now,
                catalog_name=self._name_cache.get(asset),
            )
            await self.api.send_message(int(link["chat_id"]), text)
            await asyncio.sleep(0.05)

    async def on_result(self, payload: dict[str, Any]) -> None:
        asset = str(payload.get("asset") or "")
        tf = int(payload.get("timeframe") or 0)
        entry = int(payload.get("time") or 0)
        result = str(payload.get("result") or "")
        dedupe_key = f"result:{asset}:{tf}:{entry}:{result}"
        if not await self.dedupe(dedupe_key):
            return
        await self.refresh_catalog()
        category = self._category_cache.get(asset)
        links = await self.list_enabled_links()
        for link in links:
            if not should_send_result(
                link["prefs"], enabled=True, timeframe=tf, category=category
            ):
                continue
            lang = self._lang_for_prefs(link["prefs"])
            text = format_result(lang, payload, catalog_name=self._name_cache.get(asset))
            await self.api.send_message(int(link["chat_id"]), text)
            await asyncio.sleep(0.05)

    async def listen_redis(self) -> None:
        pubsub = self.redis.pubsub()
        await pubsub.psubscribe("feed.signal.*", "feed.signal_result.*")
        logger.info("Subscribed to feed.signal.* and feed.signal_result.*")
        async for msg in pubsub.listen():
            if msg.get("type") not in ("pmessage", "message"):
                continue
            channel = str(msg.get("channel") or "")
            raw = msg.get("data")
            if not isinstance(raw, str):
                continue
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if not isinstance(payload, dict):
                continue
            try:
                if channel.startswith("feed.signal_result."):
                    await self.on_result(payload)
                elif channel.startswith("feed.signal."):
                    await self.on_signal(payload)
            except Exception:
                logger.exception("Failed handling channel %s", channel)

    async def run(self) -> None:
        # Ensure auth models / tables exist (API usually creates them).
        try:
            from webapi.auth.db import init_db

            await init_db()
        except Exception:
            logger.exception("DB init failed — continuing; link redeem may error until API creates tables")

        if not await self.acquire_poller_lock():
            raise SystemExit(2)

        await self.api.delete_webhook()
        await self.refresh_catalog(force=True)
        await asyncio.gather(self.poll_updates(), self.listen_redis())


async def _amain() -> int:
    _setup_logging()
    try:
        settings = load_settings()
    except Exception as e:
        logger.error("%s", e)
        return 1
    app = BotApp(settings)
    try:
        await app.run()
    except asyncio.CancelledError:
        pass
    finally:
        await app.close()
    return 0


def cli() -> None:
    parser = argparse.ArgumentParser(description="Quotex Telegram notification bot")
    parser.parse_args()
    try:
        raise SystemExit(asyncio.run(_amain()))
    except KeyboardInterrupt:
        raise SystemExit(0)


if __name__ == "__main__":
    cli()
