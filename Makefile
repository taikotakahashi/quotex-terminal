# Quotex Signals Platform — dev commands
# Usage: `make <target>`. Run `make help` for the list.

ROOT    := $(shell pwd)
VENV    := $(ROOT)/.venv
PY      := $(VENV)/bin/python
PIP     := $(VENV)/bin/pip
BACKEND := $(ROOT)/backend

.PHONY: help install redis feed api web telegram check doctor capture logout test stop admin smtp-test

help:
	@echo "Quotex platform — targets:"
	@echo "  make install   Set up Python venv + backend packages + frontend deps"
	@echo "  make redis     Start Redis + Postgres + Mailpit (docker compose)"
	@echo "  make capture   Refresh the Quotex session (opens a browser to log in)"
	@echo "  make logout    Switch account: clear saved login + session, then re-capture"
	@echo "  make feed      Run the Quotex feed service (needs backend/.env)"
	@echo "  make api       Run the web API (http://localhost:8000)"
	@echo "  make web       Run the dashboard dev server (http://localhost:5173)"
	@echo "  make telegram  Run the Telegram notification bot"
	@echo "  make smtp-test Test Titan/SMTP login using backend/.env"
	@echo "  make admin     Create verified admin: EMAIL=a@b.com PASSWORD='secret' make admin"
	@echo "                 Mailpit UI: http://localhost:8025"
	@echo "  make check     Verify the Quotex connection end-to-end"
	@echo "  make doctor    Network diagnostic (no Redis/creds needed)"
	@echo "  make test      Run backend unit tests"
	@echo "  make stop      Stop feed / api / vite / telegram"
	@echo ""
	@echo "Typical run: make redis && make feed &  make api &  make telegram &  make web"
	@echo "Session expired? -> make capture"

install:
	test -d $(VENV) || python3 -m venv $(VENV)
	$(PIP) install -q -e $(BACKEND)/vendor/pyquotex -e "$(BACKEND)/feed_service[test]" -e $(BACKEND)/web_api -e "$(BACKEND)/telegram_bot[test]"
	cd $(ROOT)/frontend && npm install --no-fund --no-audit

redis:
	docker compose up -d redis postgres mailpit

admin:
	@test -n "$$EMAIL" || (echo "Usage: EMAIL=a@b.com PASSWORD='secret' make admin"; exit 1)
	@test -n "$$PASSWORD" || (echo "Usage: EMAIL=a@b.com PASSWORD='secret' make admin"; exit 1)
	cd $(BACKEND) && PYTHONPATH=$(BACKEND)/web_api $(VENV)/bin/python -m webapi.auth.create_admin --email "$$EMAIL" --password "$$PASSWORD"

smtp-test:
	$(PY) $(BACKEND)/tools/smtp_test.py

# Opens a real Chrome window; log into Quotex, and the session is written to
# backend/.env. Installs Playwright on first use.
capture:
	$(PIP) install -q playwright
	$(PY) $(BACKEND)/tools/capture_session.py

logout:
	$(PY) $(BACKEND)/tools/reset_session.py

# Feed runs from backend/ so it loads backend/.env and keeps session files there.
feed:
	cd $(BACKEND) && $(VENV)/bin/quotex-feed

api:
	$(VENV)/bin/quotex-api

web:
	cd $(ROOT)/frontend && npm run dev

telegram:
	cd $(BACKEND) && PYTHONPATH=$(BACKEND)/web_api:$(BACKEND)/telegram_bot $(VENV)/bin/quotex-telegram

check:
	cd $(BACKEND) && $(VENV)/bin/quotex-feed --check

doctor:
	cd $(BACKEND) && $(VENV)/bin/quotex-feed --doctor

test:
	$(PY) -m pytest $(BACKEND)/feed_service $(BACKEND)/telegram_bot -q

stop:
	-pkill -f quotex-feed
	-pkill -f quotex-api
	-pkill -f quotex-telegram
	-pkill -f "vite"
	@echo "stopped (Redis left running; 'docker compose down' to stop it)"
