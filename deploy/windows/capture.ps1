# Open Chrome for Quotex login and write QX_SSID / cookies into backend\.env.
$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$Py = Join-Path $Root ".venv\Scripts\python.exe"
if (-not (Test-Path $Py)) { throw "Missing .venv — run deploy\windows\install.ps1 first." }
& (Join-Path $Root ".venv\Scripts\pip.exe") install -q playwright
& $Py (Join-Path $Root "backend\tools\capture_session.py")
