# Simple health watchdog — restart QuotexFeed if health endpoint is down/expired.
# Schedule every 5 minutes: Task Scheduler → powershell -File ...\watchdog.ps1
$ErrorActionPreference = "Continue"
$url = "http://127.0.0.1:8010/"
try {
    $r = Invoke-RestMethod -Uri $url -TimeoutSec 5
    if ($r.connected -eq $true) { exit 0 }
    Write-Warning "Feed not connected (status=$($r.status)). Restarting QuotexFeed…"
} catch {
    Write-Warning "Health check failed: $_. Restarting QuotexFeed…"
}

$nssm = if ($env:NSSM) { $env:NSSM } else { "nssm" }
& $nssm restart QuotexFeed
if ($LASTEXITCODE -ne 0) {
    # Fallback if not using NSSM
    Get-Process quotex-feed -ErrorAction SilentlyContinue | Stop-Process -Force
    $Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
    Start-Process (Join-Path $Root ".venv\Scripts\quotex-feed.exe") -WorkingDirectory (Join-Path $Root "backend")
}
