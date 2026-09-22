@echo off
REM Launchers for Windows VPS — run from interactive/logon session so Chrome can open.
set PYTHONUNBUFFERED=1
cd /d C:\quotex\quotex-terminal\backend
C:\quotex\quotex-terminal\.venv\Scripts\quotex-feed.exe
