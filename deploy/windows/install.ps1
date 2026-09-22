# Quotex — first-time setup on Windows Server (PowerShell as Administrator recommended).
# Prerequisites: Python 3.11+, Node.js 20+, Docker Desktop (Redis/Postgres), Chrome or Edge.
# Usage (from repo root):
#   powershell -ExecutionPolicy Bypass -File .\deploy\windows\install.ps1

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$Venv = Join-Path $Root ".venv"
$Backend = Join-Path $Root "backend"
$Py = Join-Path $Venv "Scripts\python.exe"
$Pip = Join-Path $Venv "Scripts\pip.exe"

Write-Host "Root: $Root"

if (-not (Test-Path $Venv)) {
    Write-Host "Creating venv..."
    py -3 -m venv $Venv
    if (-not (Test-Path $Py)) { python -m venv $Venv }
}

& $Pip install -q -e (Join-Path $Backend "vendor\pyquotex") `
    -e (Join-Path $Backend "feed_service[test]") `
    -e (Join-Path $Backend "web_api") `
    -e (Join-Path $Backend "telegram_bot[test]")

& $Pip install -q playwright

Push-Location (Join-Path $Root "frontend")
npm install --no-fund --no-audit
Pop-Location

$EnvExample = Join-Path $Backend ".env.example"
$EnvFile = Join-Path $Backend ".env"
if (-not (Test-Path $EnvFile)) {
    Copy-Item $EnvExample $EnvFile
    Write-Host "Created backend\.env from .env.example — edit credentials before starting."
}

Write-Host "Starting Redis + Postgres + Mailpit (Docker)..."
Push-Location $Root
docker compose up -d redis postgres mailpit
Pop-Location

Write-Host @"

Install OK.

Next:
  1. Edit backend\.env (QUOTEX_EMAIL/PASSWORD, DATABASE_URL, SESSION_SECRET, …)
  2. .\deploy\windows\capture.ps1     # log into Quotex once in Chrome
  3. .\deploy\windows\start-services.ps1   # or install-nssm-services.ps1 for auto-start

Keep a Windows user logged into the desktop so Chrome auto-refresh can open a window.
"@
