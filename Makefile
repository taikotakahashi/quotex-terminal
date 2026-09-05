# Quotex Signals Platform — dev commands
# Usage: `make <target>`. Run `make help` for the list.

ROOT    := $(shell pwd)
VENV    := $(ROOT)/.venv
PY      := $(VENV)/bin/python
PIP     := $(VENV)/bin/pip
BACKEND := $(ROOT)/backend

.PHONY: help install redis feed api web check doctor capture logout test stop

help:
	@echo "Quotex platform — targets:"
	@echo "  make install   Set up Python venv + backend packages + frontend deps"
	@echo "  make redis     Start Redis (podman/docker compose)"
	@echo "  make capture   Refresh the Quotex session (opens a browser to log in)"
	@echo "  make logout    Switch account: clear saved login + session, then re-capture"
	@echo "  make feed      Run the Quotex feed service (needs backend/.env)"
	@echo "  make api       Run the web API (http://localhost:8000)"
	@echo "  make web       Run the dashboard dev server (http://localhost:5173)"
	@echo "  make check     Verify the Quotex connection end-to-end"
	@echo "  make doctor    Network diagnostic (no Redis/creds needed)"
	@echo "  make test      Run backend unit tests"
	@echo "  make stop      Stop feed / api / vite dev server"
	@echo ""
	@echo "Typical run: make redis && make feed &  make api &  make web"
	@echo "Session expired? -> make capture"

install:
	test -d $(VENV) || python3 -m venv $(VENV)
	$(PIP) install -q -e $(BACKEND)/vendor/pyquotex -e "$(BACKEND)/feed_service[test]" -e $(BACKEND)/web_api
	cd $(ROOT)/frontend && npm install --no-fund --no-audit

redis:
	docker compose up -d redis

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

check:
	cd $(BACKEND) && $(VENV)/bin/quotex-feed --check

doctor:
	cd $(BACKEND) && $(VENV)/bin/quotex-feed --doctor

test:
	$(PY) -m pytest $(BACKEND)/feed_service -q

stop:
	-pkill -f quotex-feed
	-pkill -f quotex-api
	-pkill -f "vite"
	@echo "stopped (Redis left running; 'docker compose down' to stop it)"
