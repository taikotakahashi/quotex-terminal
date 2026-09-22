@echo off
REM Run feed in the interactive desktop (Task Scheduler: "Run only when user is logged on").
cd /d "%~dp0..\..\backend"
"%~dp0..\..\.venv\Scripts\quotex-feed.exe"
