"""Message templates (pt / en / es)."""
from __future__ import annotations

import re
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

# Entry clock shown to users (product audience is primarily Brazil).
_ENTRY_TZ = ZoneInfo("America/Sao_Paulo")

TF_LABEL = {60: "M1", 300: "M5", 900: "M15"}

# ISO currency / common ticker → flag or brand emoji (Telegram text only).
_CURRENCY_EMOJI: dict[str, str] = {
    "USD": "🇺🇸",
    "EUR": "🇪🇺",
    "GBP": "🇬🇧",
    "JPY": "🇯🇵",
    "AUD": "🇦🇺",
    "NZD": "🇳🇿",
    "CAD": "🇨🇦",
    "CHF": "🇨🇭",
    "MXN": "🇲🇽",
    "INR": "🇮🇳",
    "BRL": "🇧🇷",
    "ARS": "🇦🇷",
    "BDT": "🇧🇩",
    "COP": "🇨🇴",
    "DZD": "🇩🇿",
    "EGP": "🇪🇬",
    "IDR": "🇮🇩",
    "NGN": "🇳🇬",
    "PHP": "🇵🇭",
    "PKR": "🇵🇰",
    "ZAR": "🇿🇦",
    "HKD": "🇭🇰",
    "CNY": "🇨🇳",
    "SGD": "🇸🇬",
    "TRY": "🇹🇷",
    "RUB": "🇷🇺",
    "KRW": "🇰🇷",
    "SEK": "🇸🇪",
    "NOK": "🇳🇴",
    "DKK": "🇩🇰",
    "PLN": "🇵🇱",
    "THB": "🇹🇭",
    "VND": "🇻🇳",
}

_FIAT_CODES = sorted(_CURRENCY_EMOJI.keys(), key=len, reverse=True)

# Dedicated Quotex symbols (indices / metals / crypto / energy).
_SYMBOL_EMOJI: dict[str, str] = {
    "JPXJPY": "🇯🇵",
    "AXJAUD": "🇦🇺",
    "CHIA50": "🇨🇳",
    "F40EUR": "🇫🇷",
    "FTSGBP": "🇬🇧",
    "HSIHKD": "🇭🇰",
    "IBXEUR": "🇪🇸",
    "STXEUR": "🇪🇺",
    "XAUUSD": "🥇",
    "XAGUSD": "🥈",
    "USCRUDE": "🛢️",
    "UKBRENT": "🛢️",
    "BTCUSD": "₿",
    "ETHUSD": "Ξ",
    "LTCUSD": "Ł",
    "XRPUSD": "✕",
    "BNBUSD": "🟡",
    "BCHUSD": "₿",
    "DOTUSD": "●",
    "SOLUSD": "◎",
}


def tf_label(tf: int) -> str:
    return TF_LABEL.get(int(tf), f"{tf}s")


def format_asset_label(symbol: str, catalog_name: str | None = None) -> str:
    """Pretty-print Quotex symbols (EURUSD → EUR/USD, JPXJPY → JPX/JPY)."""
    if not symbol:
        return "?"
    # Prefer catalog when it already uses slash form (e.g. "EUR/NZD (OTC)").
    if catalog_name and "/" in catalog_name:
        return catalog_name
    otc = bool(re.search(r"_otc$", symbol, re.I))
    base = re.sub(r"_otc$", "", symbol, flags=re.I).upper()
    pretty = base
    if len(base) == 6 and base.isalpha():
        pretty = f"{base[:3]}/{base[3:]}"
    return f"{pretty} (OTC)" if otc else pretty


def asset_icon(symbol: str) -> str:
    """Currency / market emoji(s) for Telegram text (SVG sprites cannot be inlined)."""
    if not symbol:
        return ""
    base = re.sub(r"_otc$", "", symbol, flags=re.I).upper()
    dedicated = _SYMBOL_EMOJI.get(base)
    if dedicated:
        return dedicated
    for a in _FIAT_CODES:
        if not base.startswith(a):
            continue
        rest = base[len(a) :]
        if rest in _CURRENCY_EMOJI:
            left = _CURRENCY_EMOJI[a]
            right = _CURRENCY_EMOJI[rest]
            return left if left == right else f"{left}{right}"
        break
    return ""


_COPY = {
    "pt": {
        "welcome_unlinked": (
            "Bem-vindo ao Quotex Signals.\n\n"
            "Este bot envia alertas CALL/PUT (sinais apenas — não executamos ordens).\n"
            "Para ativar, faça login no site com e-mail verificado e use "
            "Conectar Telegram."
        ),
        "open_site": "Abrir o site",
        "linked_ok": (
            "Conta vinculada com sucesso.\n"
            "Escolha o idioma, o tempo e o tipo de mercado para ativar os alertas."
        ),
        "already_linked": "Esta conta Telegram já está vinculada.",
        "choose_lang": "Escolha o idioma das notificações:",
        "choose_tf": "Escolha o tempo de notificação:",
        "choose_market": "Escolha o tipo de mercado:",
        "setup_done": (
            "Configuração concluída.\n"
            "Idioma: {lang_label}\n"
            "Tempos: {tf_label}\n"
            "Mercado: {market_label}\n"
            "Alertas ligados. Comandos: /status /on /off /help"
        ),
        "lang_en": "English",
        "lang_es": "Español",
        "lang_pt": "Português (BR)",
        "tf_1m": "1M",
        "tf_5m": "5M",
        "tf_15m": "15M",
        "tf_all": "Todos",
        "mk_all": "Todos os tipos",
        "mk_currency": "Moedas",
        "mk_crypto": "Cripto",
        "mk_commodity": "Commodities",
        "mk_other": "Índices",
        "lang_label_en": "English",
        "lang_label_es": "Español",
        "lang_label_pt": "Português (BR)",
        "need_setup": "Conclua a configuração com /start (idioma + tempo + mercado) para receber alertas.",
        "err_invalid": "Link inválido ou expirado. Gere um novo no site (Conectar Telegram).",
        "err_used": "Este link já foi usado. Gere um novo no site.",
        "err_expired": "Link expirado. Gere um novo no site (válido por 10 min).",
        "err_inactive": "Conta inativa ou e-mail não verificado. Verifique no site.",
        "help": (
            "/start — informações\n"
            "/status — vínculo e sinal ativo\n"
            "/on — ligar alertas\n"
            "/off — pausar alertas\n"
            "/help — esta ajuda\n\n"
            "Vincule pelo botão Conectar Telegram no site."
        ),
        "enabled": "Alertas ligados.",
        "disabled": "Alertas pausados. Use /on para reativar.",
        "not_linked": "Ainda não vinculado. Use Conectar Telegram no site.",
        "status_linked": "Vinculado · alertas {state}\nPreferências: {market_label} · {tf_label} · resultados on",
        "status_on": "ON",
        "status_off": "OFF",
        "signal": (
            "{emoji} {direction} · {asset}{icon_part}\n\n"
            "⏰ Entrada: {entry_time}\n"
            "⏱️ Expiração: {tf_exp}\n\n"
            "📊 Confiança da análise: {conf}%\n"
            "{payout_line}"
            "\n⚠️ Aguarde o horário exato para realizar a entrada."
        ),
        "payout_line": "💰 Payout: {payout}%\n",
        "tf_exp_60": "M1 (1 minuto)",
        "tf_exp_300": "M5 (5 minutos)",
        "tf_exp_900": "M15 (15 minutos)",
        "result": "{emoji} {result} · {asset} · {tf} · {direction}",
        "disclaimer_short": "Sinais apenas — não executamos ordens.",
    },
    "en": {
        "welcome_unlinked": (
            "Welcome to Quotex Signals.\n\n"
            "This bot sends CALL/PUT alerts (signals only — we never place trades).\n"
            "To enable alerts, sign in on the website with a verified email and use "
            "Connect Telegram."
        ),
        "open_site": "Open website",
        "linked_ok": (
            "Account linked successfully.\n"
            "Choose your language, notification time, and market type to enable alerts."
        ),
        "already_linked": "This Telegram chat is already linked.",
        "choose_lang": "Choose your notification language:",
        "choose_tf": "Choose your notification time:",
        "choose_market": "Choose your market type:",
        "setup_done": (
            "Setup complete.\n"
            "Language: {lang_label}\n"
            "Times: {tf_label}\n"
            "Market: {market_label}\n"
            "Alerts enabled. Commands: /status /on /off /help"
        ),
        "lang_en": "English",
        "lang_es": "Español",
        "lang_pt": "Português (BR)",
        "tf_1m": "1M",
        "tf_5m": "5M",
        "tf_15m": "15M",
        "tf_all": "All",
        "mk_all": "All types",
        "mk_currency": "Currencies",
        "mk_crypto": "Crypto",
        "mk_commodity": "Commodities",
        "mk_other": "Indices",
        "lang_label_en": "English",
        "lang_label_es": "Español",
        "lang_label_pt": "Português (BR)",
        "need_setup": "Finish setup with /start (language + time + market) to receive alerts.",
        "err_invalid": "Invalid or expired link. Create a new one on the website.",
        "err_used": "This link was already used. Create a new one on the website.",
        "err_expired": "Link expired. Create a new one on the website (valid 10 min).",
        "err_inactive": "Inactive account or unverified email. Check the website.",
        "help": (
            "/start — info\n"
            "/status — link status\n"
            "/on — enable alerts\n"
            "/off — mute alerts\n"
            "/help — this help\n\n"
            "Link via Connect Telegram on the website."
        ),
        "enabled": "Alerts enabled.",
        "disabled": "Alerts paused. Use /on to resume.",
        "not_linked": "Not linked yet. Use Connect Telegram on the website.",
        "status_linked": "Linked · alerts {state}\nPrefs: {market_label} · {tf_label} · results on",
        "status_on": "ON",
        "status_off": "OFF",
        "signal": (
            "{emoji} {direction} · {asset}{icon_part}\n\n"
            "⏰ Entry: {entry_time}\n"
            "⏱️ Expiration: {tf_exp}\n\n"
            "📊 Analysis confidence: {conf}%\n"
            "{payout_line}"
            "\n⚠️ Wait for the exact time to enter the trade."
        ),
        "payout_line": "💰 Payout: {payout}%\n",
        "tf_exp_60": "M1 (1 minute)",
        "tf_exp_300": "M5 (5 minutes)",
        "tf_exp_900": "M15 (15 minutes)",
        "result": "{emoji} {result} · {asset} · {tf} · {direction}",
        "disclaimer_short": "Signals only — we never place trades.",
    },
    "es": {
        "welcome_unlinked": (
            "Bienvenido a Quotex Signals.\n\n"
            "Este bot envía alertas CALL/PUT (solo señales — no ejecutamos órdenes).\n"
            "Para activar, inicia sesión en el sitio con email verificado y usa "
            "Conectar Telegram."
        ),
        "open_site": "Abrir el sitio",
        "linked_ok": (
            "Cuenta vinculada con éxito.\n"
            "Elige el idioma, el tiempo y el tipo de mercado para activar las alertas."
        ),
        "already_linked": "Este chat ya está vinculado.",
        "choose_lang": "Elige el idioma de las notificaciones:",
        "choose_tf": "Elige el tiempo de notificación:",
        "choose_market": "Elige el tipo de mercado:",
        "setup_done": (
            "Configuración completa.\n"
            "Idioma: {lang_label}\n"
            "Tiempos: {tf_label}\n"
            "Mercado: {market_label}\n"
            "Alertas activadas. Comandos: /status /on /off /help"
        ),
        "lang_en": "English",
        "lang_es": "Español",
        "lang_pt": "Português (BR)",
        "tf_1m": "1M",
        "tf_5m": "5M",
        "tf_15m": "15M",
        "tf_all": "Todos",
        "mk_all": "Todos los tipos",
        "mk_currency": "Divisas",
        "mk_crypto": "Cripto",
        "mk_commodity": "Materias primas",
        "mk_other": "Índices",
        "lang_label_en": "English",
        "lang_label_es": "Español",
        "lang_label_pt": "Português (BR)",
        "need_setup": "Completa la configuración con /start (idioma + tiempo + mercado) para recibir alertas.",
        "err_invalid": "Enlace inválido o expirado. Genera uno nuevo en el sitio.",
        "err_used": "Este enlace ya se usó. Genera uno nuevo en el sitio.",
        "err_expired": "Enlace expirado. Genera uno nuevo en el sitio (válido 10 min).",
        "err_inactive": "Cuenta inactiva o email no verificado. Revisa el sitio.",
        "help": (
            "/start — info\n"
            "/status — estado\n"
            "/on — activar alertas\n"
            "/off — pausar alertas\n"
            "/help — esta ayuda\n\n"
            "Vincula con Conectar Telegram en el sitio."
        ),
        "enabled": "Alertas activadas.",
        "disabled": "Alertas en pausa. Usa /on para reactivar.",
        "not_linked": "Aún no vinculado. Usa Conectar Telegram en el sitio.",
        "status_linked": "Vinculado · alertas {state}\nPrefs: {market_label} · {tf_label} · resultados on",
        "status_on": "ON",
        "status_off": "OFF",
        "signal": (
            "{emoji} {direction} · {asset}{icon_part}\n\n"
            "⏰ Entrada: {entry_time}\n"
            "⏱️ Expiración: {tf_exp}\n\n"
            "📊 Confianza del análisis: {conf}%\n"
            "{payout_line}"
            "\n⚠️ Espere la hora exacta para realizar la entrada."
        ),
        "payout_line": "💰 Payout: {payout}%\n",
        "tf_exp_60": "M1 (1 minuto)",
        "tf_exp_300": "M5 (5 minutos)",
        "tf_exp_900": "M15 (15 minutos)",
        "result": "{emoji} {result} · {asset} · {tf} · {direction}",
        "disclaimer_short": "Solo señales — no ejecutamos órdenes.",
    },
}


def t(lang: str, key: str, **kwargs: Any) -> str:
    lang = lang if lang in _COPY else "pt"
    text = _COPY[lang].get(key) or _COPY["pt"].get(key) or key
    if kwargs:
        return text.format(**kwargs)
    return text


def telegram_url_button_ok(app_url: str) -> bool:
    """Telegram rejects localhost / plain LAN URLs on inline keyboard buttons."""
    from urllib.parse import urlparse

    try:
        u = urlparse((app_url or "").strip())
    except Exception:
        return False
    if u.scheme != "https":
        return False
    host = (u.hostname or "").lower()
    if not host or host in ("localhost", "127.0.0.1", "::1") or host.endswith(".local"):
        return False
    return True


def site_keyboard(app_url: str, lang: str) -> dict | None:
    if not telegram_url_button_ok(app_url):
        return None
    return {
        "inline_keyboard": [[{"text": t(lang, "open_site"), "url": app_url}]],
    }


def language_keyboard(lang: str) -> dict:
    return {
        "inline_keyboard": [
            [
                {"text": t(lang, "lang_en"), "callback_data": "setup:lang:en"},
                {"text": t(lang, "lang_es"), "callback_data": "setup:lang:es"},
            ],
            [
                {"text": t(lang, "lang_pt"), "callback_data": "setup:lang:pt"},
            ],
        ]
    }


def timeframe_keyboard(lang: str) -> dict:
    return {
        "inline_keyboard": [
            [
                {"text": t(lang, "tf_1m"), "callback_data": "setup:tf:60"},
                {"text": t(lang, "tf_5m"), "callback_data": "setup:tf:300"},
                {"text": t(lang, "tf_15m"), "callback_data": "setup:tf:900"},
                {"text": t(lang, "tf_all"), "callback_data": "setup:tf:all"},
            ]
        ]
    }


def market_keyboard(lang: str) -> dict:
    """Vertical list matching the dashboard market filter (All / Currencies / …)."""
    return {
        "inline_keyboard": [
            [{"text": t(lang, "mk_all"), "callback_data": "setup:market:all"}],
            [{"text": t(lang, "mk_currency"), "callback_data": "setup:market:currency"}],
            [{"text": t(lang, "mk_crypto"), "callback_data": "setup:market:crypto"}],
            [{"text": t(lang, "mk_commodity"), "callback_data": "setup:market:commodity"}],
            [{"text": t(lang, "mk_other"), "callback_data": "setup:market:other"}],
        ]
    }


def tf_pref_label(lang: str, timeframes: list[int]) -> str:
    tfs = sorted({int(x) for x in timeframes})
    if tfs == [60, 300, 900]:
        return t(lang, "tf_all")
    parts = []
    for tf in tfs:
        if tf == 60:
            parts.append(t(lang, "tf_1m"))
        elif tf == 300:
            parts.append(t(lang, "tf_5m"))
        elif tf == 900:
            parts.append(t(lang, "tf_15m"))
    return " · ".join(parts) if parts else t(lang, "tf_all")


def market_pref_label(lang: str, markets: list[str] | None) -> str:
    ms = [m for m in (markets or []) if isinstance(m, str) and m.strip()]
    if not ms:
        return t(lang, "mk_all")
    labels = []
    for m in ms:
        key = f"mk_{m}"
        label = t(lang, key)
        labels.append(label if label != key else m)
    return " · ".join(labels)


def with_site_link(text: str, app_url: str, lang: str) -> str:
    """Append site URL in plain text when an inline URL button is not allowed."""
    url = (app_url or "").rstrip("/")
    if not url or telegram_url_button_ok(url):
        return text
    label = t(lang, "open_site")
    return f"{text}\n\n{label}:\n{url}"


def _asset_display(symbol: str, catalog_name: str | None = None) -> str:
    label = format_asset_label(symbol, catalog_name)
    icon = asset_icon(symbol)
    return f"{icon} {label}" if icon else label


def _tf_expiration(lang: str, tf: int) -> str:
    key = f"tf_exp_{int(tf)}"
    label = t(lang, key)
    if label == key:
        return tf_label(tf)
    return label


def _entry_clock(entry_start: float) -> str:
    if not entry_start:
        return "—"
    return datetime.fromtimestamp(entry_start, tz=_ENTRY_TZ).strftime("%H:%M:%S")


def format_signal(
    lang: str,
    payload: dict[str, Any],
    *,
    payout: float | None,
    now: float,
    catalog_name: str | None = None,
) -> str:
    del now  # kept for call-site compatibility
    direction = str(payload.get("direction") or "").upper()
    emoji = "🟢" if direction == "CALL" else "🔴"
    entry = float(payload.get("entry_start") or 0)
    conf = int(payload.get("confidence") or 0)
    payout_line = ""
    if payout is not None and payout > 0:
        payout_line = t(lang, "payout_line", payout=int(round(payout)))
    symbol = str(payload.get("asset") or "")
    icon = asset_icon(symbol)
    icon_part = f" {icon}" if icon else ""
    tf = int(payload.get("timeframe") or 60)
    return t(
        lang,
        "signal",
        emoji=emoji,
        direction=direction,
        asset=format_asset_label(symbol, catalog_name),
        icon_part=icon_part,
        entry_time=_entry_clock(entry),
        tf_exp=_tf_expiration(lang, tf),
        conf=conf,
        payout_line=payout_line,
    )


def format_result(
    lang: str,
    payload: dict[str, Any],
    *,
    catalog_name: str | None = None,
) -> str:
    result = str(payload.get("result") or "").upper()
    if result == "WIN":
        emoji = "✅"
    elif result == "LOSS":
        emoji = "❌"
    else:
        emoji = "➖"
    symbol = str(payload.get("asset") or "")
    return t(
        lang,
        "result",
        emoji=emoji,
        result=result,
        asset=_asset_display(symbol, catalog_name),
        tf=tf_label(int(payload.get("timeframe") or 60)),
        direction=str(payload.get("direction") or "").upper(),
    )
