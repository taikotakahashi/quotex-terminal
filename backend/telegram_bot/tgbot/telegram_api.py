"""Telegram Bot API thin client (long polling)."""
from __future__ import annotations

import logging
from typing import Any

import httpx

logger = logging.getLogger("tgbot.api")


class TelegramApiError(RuntimeError):
    def __init__(self, description: str, *, error_code: int | None = None):
        super().__init__(description)
        self.error_code = error_code


class TelegramConflictError(TelegramApiError):
    """Another getUpdates poller is already running for this bot token."""


class TelegramApi:
    def __init__(self, token: str):
        self._base = f"https://api.telegram.org/bot{token}"
        self._client = httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=15.0))

    async def close(self) -> None:
        await self._client.aclose()

    async def _call(self, method: str, **payload: Any) -> Any:
        url = f"{self._base}/{method}"
        # Long poll getUpdates uses long read timeout.
        timeout = 60.0 if method == "getUpdates" else 30.0
        resp = await self._client.post(url, json=payload, timeout=timeout)
        data = resp.json()
        if not data.get("ok"):
            code = data.get("error_code")
            desc = data.get("description") or f"Telegram API error: {method}"
            if code == 409 or "Conflict" in str(desc):
                raise TelegramConflictError(str(desc), error_code=409)
            logger.warning("Telegram %s failed: %s", method, data)
            raise TelegramApiError(str(desc), error_code=int(code) if code else None)
        return data.get("result")

    async def delete_webhook(self) -> None:
        """Ensure long-polling works (webhook and getUpdates cannot both run)."""
        try:
            await self._call("deleteWebhook", drop_pending_updates=False)
        except TelegramApiError:
            logger.warning("deleteWebhook failed; continuing with getUpdates")

    async def get_updates(self, offset: int | None, timeout: int = 25) -> list[dict]:
        payload: dict[str, Any] = {
            "timeout": timeout,
            "allowed_updates": ["message", "callback_query"],
        }
        if offset is not None:
            payload["offset"] = offset
        result = await self._call("getUpdates", **payload)
        return result or []

    async def send_message(
        self,
        chat_id: int,
        text: str,
        *,
        reply_markup: dict | None = None,
        disable_preview: bool = True,
    ) -> dict | None:
        payload: dict[str, Any] = {
            "chat_id": chat_id,
            "text": text,
            "disable_web_page_preview": disable_preview,
        }
        if reply_markup is not None:
            payload["reply_markup"] = reply_markup
        try:
            return await self._call("sendMessage", **payload)
        except TelegramApiError as e:
            logger.warning("sendMessage failed chat=%s: %s", chat_id, e)
            return None
        except Exception:
            logger.exception("sendMessage failed chat=%s", chat_id)
            return None

    async def answer_callback(self, callback_query_id: str, text: str | None = None) -> None:
        payload: dict[str, Any] = {"callback_query_id": callback_query_id}
        if text:
            payload["text"] = text
        try:
            await self._call("answerCallbackQuery", **payload)
        except Exception:
            logger.exception("answerCallbackQuery failed")
