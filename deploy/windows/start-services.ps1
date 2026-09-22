# Start feed + API + Telegram + Vite in separate consoles (dev / first bring-up).
# For production auto-start use install-nssm-services.ps1 instead.
$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$VenvScripts = Join-Path $Root ".venv\Scripts"
$Backend = Join-Path $Root "backend"

function Start-QxConsole([string]$Title, [string]$WorkDir, [string]$Command) {
    Start-Process powershell -ArgumentList @(
        "-NoExit", "-Command",
        "Set-Location '$WorkDir'; `$host.UI.RawUI.WindowTitle = '$Title'; $Command"
    )
}

Start-QxConsole "quotex-feed" $Backend "& '$VenvScripts\quotex-feed.exe'"
Start-QxConsole "quotex-api" $Root "& '$VenvScripts\quotex-api.exe'"
Start-QxConsole "quotex-telegram" $Backend (
    "`$env:PYTHONPATH = '$Backend\web_api;$Backend\telegram_bot'; & '$VenvScripts\quotex-telegram.exe'"
)
Start-QxConsole "quotex-web" (Join-Path $Root "frontend") "npm run dev"

Write-Host "Started feed, api, telegram, web. Dashboard: http://localhost:5173"
Write-Host "Keep this Windows session logged in so Chrome auto-refresh can use the desktop."
