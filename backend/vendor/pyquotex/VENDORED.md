upstream: https://github.com/cleitonleonel/pyquotex
commit: 5e85fcb6bb378681f73b7df34e9caa7d0e6298d7
vendored: 2026-09-03
reason: unofficial Quotex client; vendored so protocol breakages can be patched
        locally without waiting on upstream.

Local modifications
-------------------
2026-09-03 — WebSocket transport migrated from the `websockets` library to
curl_cffi's AsyncWebSocket with browser TLS impersonation.

  Why: Cloudflare rejects the WebSocket UPGRADE to wss://ws2.qxbroker.com with
  HTTP 403 when the TLS ClientHello is not browser-like (JA3 fingerprinting is
  enforced on the WS endpoint, though plain HTTPS/polling is allowed). Verified
  by direct testing: the `websockets` library 403s from the same IP where
  curl_cffi (impersonate="chrome") connects successfully.

  Files touched:
    - pyquotex/ws/client.py    transport rewritten to curl_cffi AsyncSession;
                               State/ConnectionClosed replaced with an internal
                               _is_open flag; reconnect/watchdog/replay kept.
                               send() forces CurlWsFlag.TEXT — socket.io frames
                               are TEXT and curl_cffi defaults to BINARY, which
                               Quotex silently drops (auth never completes).
    - pyquotex/_api/account.py sets api.impersonate before connecting.
    - pyquotex/stable_api.py   new Quotex(impersonate="chrome") kwarg.
    - pyproject.toml           added curl_cffi dependency.

  Tunable via the feed service env var QX_IMPERSONATE (default "chrome").

2026-09-03 — distinguish an expired-session rejection from a transport 403.
    - pyquotex/api.py          _on_message sets a sticky `self.auth_rejected`
                               flag on `authorization/reject` (survives the
                               reconnect that resets state.auth_status).
    - pyquotex/_api/account.py returns "authorization_rejected" (not the generic
                               "Websocket connection rejected") when that flag is
                               set, so the feed can tell the user their SSID
                               expired vs. a Cloudflare/transport failure.

2026-09-04 — route the realtime WebSocket through a proxy (not just HTTP).
    - pyquotex/_api/account.py sets api.proxy_url from the Quotex instance.
    - pyquotex/ws/client.py     passes proxy=api.proxy_url to curl_cffi
                                ws_connect when set (QX_PROXY).
