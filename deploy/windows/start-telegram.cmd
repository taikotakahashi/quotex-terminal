@echo off
set PYTHONUNBUFFERED=1
set REDIS_URL=redis://127.0.0.1:6379/0
set PYTHONPATH=C:\quotex\quotex-terminal\backend\web_api;C:\quotex\quotex-terminal\backend\telegram_bot
cd /d C:\quotex\quotex-terminal\backend
C:\quotex\quotex-terminal\.venv\Scripts\quotex-telegram.exe
