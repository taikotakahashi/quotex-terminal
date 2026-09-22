# Register Windows services via NSSM (https://nssm.cc/download).
# IMPORTANT: Install the *feed* service to run in the interactive user session
# (or use Task Scheduler "Run only when user is logged on"). Session 0 cannot
# show Chrome on the desktop, so auto-refresh/auto-login will fail there.
#
# Usage (Admin PowerShell, from repo root after install.ps1):
#   .\deploy\windows\install-nssm-services.ps1
# Optional: $env:NSSM = "C:\Tools\nssm\win64\nssm.exe"

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$VenvScripts = Join-Path $Root ".venv\Scripts"
$Backend = Join-Path $Root "backend"
$Nssm = if ($env:NSSM) { $env:NSSM } else { (Get-Command nssm -ErrorAction SilentlyContinue).Source }
if (-not $Nssm) { throw "nssm.exe not found. Install NSSM and add it to PATH, or set `$env:NSSM." }

function Install-QxService(
    [string]$Name,
    [string]$App,
    [string]$WorkDir,
    [hashtable]$EnvVars = @{}
) {
    & $Nssm stop $Name 2>$null
    & $Nssm remove $Name confirm 2>$null
    & $Nssm install $Name $App
    & $Nssm set $Name AppDirectory $WorkDir
    & $Nssm set $Name AppStdout (Join-Path $Root "logs\$Name.out.log")
    & $Nssm set $Name AppStderr (Join-Path $Root "logs\$Name.err.log")
    & $Nssm set $Name AppRotateFiles 1
    & $Nssm set $Name AppEnvironmentExtra "PYTHONUNBUFFERED=1"
    foreach ($k in $EnvVars.Keys) {
        $cur = & $Nssm get $Name AppEnvironmentExtra
        & $Nssm set $Name AppEnvironmentExtra "$cur`n$k=$($EnvVars[$k])"
    }
    & $Nssm set $Name Start SERVICE_AUTO_START
    Write-Host "Installed $Name"
}

New-Item -ItemType Directory -Force -Path (Join-Path $Root "logs") | Out-Null

Install-QxService "QuotexFeed" (Join-Path $VenvScripts "quotex-feed.exe") $Backend
Install-QxService "QuotexApi" (Join-Path $VenvScripts "quotex-api.exe") $Root @{
    "REDIS_URL" = "redis://localhost:6379/0"
    "WEBAPI_HOST" = "0.0.0.0"
    "WEBAPI_PORT" = "8000"
}
$PyPath = "$Backend\web_api;$Backend\telegram_bot"
Install-QxService "QuotexTelegram" (Join-Path $VenvScripts "quotex-telegram.exe") $Backend @{
    "PYTHONPATH" = $PyPath
}

Write-Host @"

Services registered. Start with:
  nssm start QuotexFeed
  nssm start QuotexApi
  nssm start QuotexTelegram

If Chrome auto-refresh fails, run QuotexFeed under the logged-in desktop user
(Task Scheduler → At log on → deploy\windows\run-feed.cmd) instead of Session 0.
"@
