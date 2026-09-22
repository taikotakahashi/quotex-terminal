@echo off
REM Run feed in the interactive desktop (needed for Chrome auto-login on Windows).
REM Prefer this over Session-0 NSSM when Quotex session expires.
set PYTHONUNBUFFERED=1
cd /d C:\quotex\quotex-terminal\backend
C:\quotex\quotex-terminal\.venv\Scripts\quotex-feed.exe >> C:\quotex\logs\QuotexFeed.out.log 2>> C:\quotex\logs\QuotexFeed.err.log
