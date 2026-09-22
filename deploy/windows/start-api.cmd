@echo off
set PYTHONUNBUFFERED=1
set WEBAPI_HOST=0.0.0.0
set WEBAPI_PORT=8000
set REDIS_URL=redis://127.0.0.1:6379/0
cd /d C:\quotex\quotex-terminal
C:\quotex\quotex-terminal\.venv\Scripts\quotex-api.exe
