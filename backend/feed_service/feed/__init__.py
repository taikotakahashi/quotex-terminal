"""Quotex Feed Service.

Connects to Quotex's (unofficial) WebSocket API and publishes the live asset
catalog with payouts, ticks, and aggregated M1/M5/M15 candles into Redis.
Nothing downstream ever talks to Quotex directly — see ARCHITECTURE.md.
"""

__version__ = "0.1.0"
