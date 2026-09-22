from tgbot.filters import should_send_result, should_send_signal
from tgbot.messages import format_result, format_signal, tf_label


def test_tf_label():
    assert tf_label(60) == "M1"
    assert tf_label(300) == "M5"
    assert tf_label(900) == "M15"


def test_should_send_all_markets_default():
    prefs = {"timeframes": [60, 300, 900], "markets": [], "min_confidence": 90, "results": True}
    assert should_send_signal(
        prefs, enabled=True, timeframe=300, category="currency", confidence=92, payout=80
    )
    assert not should_send_signal(
        prefs, enabled=True, timeframe=300, category="currency", confidence=80, payout=80
    )
    assert not should_send_signal(
        prefs, enabled=False, timeframe=300, category="currency", confidence=95, payout=80
    )


def test_market_filter():
    prefs = {"timeframes": [300], "markets": ["currency"], "min_confidence": 90, "results": True}
    assert should_send_signal(
        prefs, enabled=True, timeframe=300, category="currency", confidence=91, payout=80
    )
    assert not should_send_signal(
        prefs, enabled=True, timeframe=300, category="crypto", confidence=91, payout=80
    )


def test_result_filter():
    prefs = {"timeframes": [60], "markets": [], "results": False}
    assert not should_send_result(prefs, enabled=True, timeframe=60, category="currency")
    prefs["results"] = True
    assert should_send_result(prefs, enabled=True, timeframe=60, category="currency")


def test_setup_incomplete_blocks_alerts():
    prefs = {
        "timeframes": [60, 300, 900],
        "markets": [],
        "min_confidence": 90,
        "results": True,
        "setup_complete": False,
    }
    assert not should_send_signal(
        prefs, enabled=True, timeframe=60, category="currency", confidence=95, payout=80
    )
    assert not should_send_result(prefs, enabled=True, timeframe=60, category="currency")
    prefs["setup_complete"] = True
    assert should_send_signal(
        prefs, enabled=True, timeframe=60, category="currency", confidence=95, payout=80
    )


def test_language_and_timeframe_keyboards():
    from tgbot.messages import language_keyboard, market_keyboard, timeframe_keyboard

    lang_kb = language_keyboard("en")
    buttons = [b for row in lang_kb["inline_keyboard"] for b in row]
    assert {b["callback_data"] for b in buttons} == {
        "setup:lang:en",
        "setup:lang:es",
        "setup:lang:pt",
    }
    tf_kb = timeframe_keyboard("pt")
    tf_buttons = [b for row in tf_kb["inline_keyboard"] for b in row]
    assert [b["text"] for b in tf_buttons] == ["1M", "5M", "15M", "Todos"]
    assert [b["callback_data"] for b in tf_buttons] == [
        "setup:tf:60",
        "setup:tf:300",
        "setup:tf:900",
        "setup:tf:all",
    ]
    mk_kb = market_keyboard("en")
    mk_buttons = [b for row in mk_kb["inline_keyboard"] for b in row]
    assert [b["text"] for b in mk_buttons] == [
        "All types",
        "Currencies",
        "Crypto",
        "Commodities",
        "Indices",
    ]
    assert [b["callback_data"] for b in mk_buttons] == [
        "setup:market:all",
        "setup:market:currency",
        "setup:market:crypto",
        "setup:market:commodity",
        "setup:market:other",
    ]


def test_market_pref_label():
    from tgbot.messages import market_pref_label

    assert market_pref_label("en", []) == "All types"
    assert market_pref_label("en", ["currency"]) == "Currencies"
    assert market_pref_label("pt", ["other"]) == "Índices"


def test_format_signal_pt():
    text = format_signal(
        "pt",
        {
            "direction": "PUT",
            "asset": "CADCHF_otc",
            "timeframe": 60,
            "confidence": 95,
            "entry_start": 1_700_000_180,
        },
        payout=88,
        now=1_700_000_000,
    )
    assert "PUT" in text
    assert "CAD/CHF (OTC)" in text
    assert "🇨🇦" in text and "🇨🇭" in text
    assert text.index("CAD/CHF (OTC)") < text.index("🇨🇦")
    assert "M1 (1 minuto)" in text
    assert "Confiança da análise: 95%" in text
    assert "Payout: 88%" in text
    assert "Aguarde o horário exato" in text
    assert "Entrada:" in text
    # Flags after asset on the first line
    first = text.splitlines()[0]
    assert first.startswith("🔴 PUT · CAD/CHF (OTC)")


def test_format_signal_jpx():
    text = format_signal(
        "en",
        {
            "direction": "CALL",
            "asset": "JPXJPY",
            "timeframe": 300,
            "confidence": 95,
            "entry_start": 1_700_000_180,
        },
        payout=40,
        now=1_700_000_000,
    )
    assert "JPX/JPY" in text
    assert "🇯🇵" in text
    assert "M5 (5 minutes)" in text
    assert "Analysis confidence: 95%" in text
    assert "JPXJPY" not in text.replace("JPX/JPY", "")


def test_format_result():
    text = format_result(
        "en",
        {"result": "WIN", "asset": "EURUSD", "timeframe": 60, "direction": "PUT"},
    )
    assert "WIN" in text
    assert "PUT" in text
    assert "EUR/USD" in text
    assert "🇪🇺" in text and "🇺🇸" in text


def test_localhost_keyboard_skipped():
    from tgbot.messages import site_keyboard, telegram_url_button_ok, with_site_link

    assert not telegram_url_button_ok("http://localhost:5173")
    assert site_keyboard("http://localhost:5173", "pt") is None
    assert telegram_url_button_ok("https://signals.example.com")
    assert site_keyboard("https://signals.example.com", "en") is not None
    body = with_site_link("Hello", "http://localhost:5173", "en")
    assert "http://localhost:5173" in body
    assert "Open website" in body
