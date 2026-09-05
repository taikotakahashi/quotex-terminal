"""Quotex web API.

A read-only FastAPI service that exposes the feed's Redis data to the frontend:
REST for initial state, a WebSocket for live updates. It never talks to Quotex
directly — it only reads what the feed service publishes into Redis.
"""

__version__ = "0.1.0"
