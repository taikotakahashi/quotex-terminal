# Install Caddy + wire masterwinn.com on this Windows VPS.
# Run as Administrator after DNS A records point here:
#   powershell -ExecutionPolicy Bypass -File C:\quotex\quotex-terminal\deploy\windows\setup-domain.ps1

$ErrorActionPreference = "Stop"
$Root = "C:\quotex\quotex-terminal"
$CaddyDir = "C:\quotex\caddy"
$Domain = "masterwinn.com"

New-Item -ItemType Directory -Force -Path $CaddyDir | Out-Null
New-Item -ItemType Directory -Force -Path "$CaddyDir\data" | Out-Null
New-Item -ItemType Directory -Force -Path "$CaddyDir\config" | Out-Null
New-Item -ItemType Directory -Force -Path "C:\quotex\logs" | Out-Null

$env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
            [System.Environment]::GetEnvironmentVariable("Path", "User")

if (-not (Get-Command caddy -ErrorAction SilentlyContinue)) {
    Write-Host "Installing Caddy via Chocolatey..."
    choco install -y caddy --no-progress
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("Path", "User")
}

Copy-Item "$Root\deploy\windows\Caddyfile" "$CaddyDir\Caddyfile" -Force

# Firewall
foreach ($p in 80, 443) {
    $name = "QuotexPort$p"
    Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    New-NetFirewallRule -DisplayName $name -Direction Inbound -Protocol TCP -LocalPort $p `
        -Action Allow -Profile Any -Enabled True | Out-Null
}

# Patch backend .env for HTTPS same-origin
$envPath = "$Root\backend\.env"
$updates = @{
    "APP_PUBLIC_URL" = "https://$Domain"
    "WEBAPI_CORS"    = "https://$Domain,https://www.$Domain"
    "COOKIE_SECURE"  = "true"
}
$lines = Get-Content $envPath
$seen = @{}
$out = foreach ($line in $lines) {
    if ($line -match "^\s*#" -or $line -notmatch "=") { $line; continue }
    $k = ($line -split "=", 2)[0]
    if ($updates.ContainsKey($k)) { "$k=$($updates[$k])"; $seen[$k] = $true; continue }
    $line
}
foreach ($k in $updates.Keys) {
    if (-not $seen.ContainsKey($k)) { $out += "$k=$($updates[$k])" }
}
Set-Content -Path $envPath -Value $out -Encoding utf8
Write-Host "Patched backend\.env for https://$Domain"

# Rebuild frontend for same-origin (empty VITE_API_BASE)
$fe = Join-Path $Root "frontend"
@"
# Same-origin via Caddy — leave blank
"@ | Set-Content (Join-Path $fe ".env") -Encoding utf8
@"
# Same-origin via Caddy — leave blank
"@ | Set-Content (Join-Path $fe ".env.production") -Encoding utf8
Push-Location $fe
npm run build
Pop-Location

# Restart API so it picks up COOKIE_SECURE / CORS
Get-Process quotex-api -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep 1
Start-Process "C:\quotex\start-api.cmd" -WindowStyle Hidden

# Install / restart Caddy as Windows service via sc + nssm if available, else scheduled task
$caddyExe = (Get-Command caddy).Source
Get-Service caddy -ErrorAction SilentlyContinue | Stop-Service -Force -ErrorAction SilentlyContinue
Get-Process caddy -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

$nssm = Get-Command nssm -ErrorAction SilentlyContinue
if ($nssm) {
    & nssm stop QuotexCaddy 2>$null
    & nssm remove QuotexCaddy confirm 2>$null
    & nssm install QuotexCaddy $caddyExe
    & nssm set QuotexCaddy AppDirectory $CaddyDir
    & nssm set QuotexCaddy AppParameters "run --config $CaddyDir\Caddyfile --adapter caddyfile"
    & nssm set QuotexCaddy AppEnvironmentExtra "XDG_DATA_HOME=$CaddyDir\data" "XDG_CONFIG_HOME=$CaddyDir\config"
    & nssm set QuotexCaddy AppStdout "C:\quotex\logs\caddy.out.log"
    & nssm set QuotexCaddy AppStderr "C:\quotex\logs\caddy.err.log"
    & nssm set QuotexCaddy Start SERVICE_AUTO_START
    & nssm start QuotexCaddy
    Write-Host "Caddy installed as QuotexCaddy service"
} else {
    # Fallback: start in background (survives until reboot; install NSSM later for permanence)
    $env:XDG_DATA_HOME = "$CaddyDir\data"
    $env:XDG_CONFIG_HOME = "$CaddyDir\config"
    Start-Process -FilePath $caddyExe -ArgumentList "run","--config","$CaddyDir\Caddyfile","--adapter","caddyfile" `
        -WorkingDirectory $CaddyDir -WindowStyle Hidden `
        -RedirectStandardOutput "C:\quotex\logs\caddy.out.log" `
        -RedirectStandardError "C:\quotex\logs\caddy.err.log"
    Write-Host "Caddy started in background (install NSSM for auto-start on reboot)"
}

Start-Sleep 3
Get-Process caddy -ErrorAction SilentlyContinue | Format-Table Id, ProcessName
Write-Host @"

Done on the server side.

DNS (HostGator) — you must do this if not already pointing here:
  Type A   @     ->  YOUR_VPS_IP
  Type A   www   ->  YOUR_VPS_IP

After DNS propagates, open https://$Domain
"@
