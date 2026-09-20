# Ahuva IT Support Assistant — Windows Installer v1.6.0
# ─────────────────────────────────────────────────────────────────────────────
# ONE-LINER (run from any PowerShell window — no admin needed):
#
#   powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1
#
# Or download + run directly:
#   iwr -useb "https://raw.githubusercontent.com/enoshvarma/ahuva-it-support-assistant/main/scripts/install-windows.ps1" | iex
#
# What this script does:
#   1. Installs Git (via winget) if missing
#   2. Installs Node.js LTS (via winget) if missing or < v20
#   3. Clones / updates the repo to %LOCALAPPDATA%\AhuvaITAssistant
#   4. Runs npm install
#   5. Creates a Desktop shortcut + Start Menu entry
#   6. Optionally launches the app
# ─────────────────────────────────────────────────────────────────────────────

$ErrorActionPreference = "Stop"

$AppName    = "Ahuva IT Support Assistant"
$RepoUrl    = "https://github.com/enoshvarma/ahuva-it-support-assistant.git"
$InstallDir = "$env:LOCALAPPDATA\AhuvaITAssistant"
$Version    = "1.6.0"

# ── colour helpers ───────────────────────────────────────────────────────────
function Write-Step   { param($n,$t) Write-Host "  [$n] $t" -ForegroundColor Yellow }
function Write-OK     { param($t)    Write-Host "      OK  $t" -ForegroundColor Green }
function Write-Info   { param($t)    Write-Host "      ->  $t" -ForegroundColor Cyan }
function Write-Fail   { param($t)    Write-Host "      !!  $t" -ForegroundColor Red }
function Write-Banner {
    Write-Host ""
    Write-Host "  ╔══════════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "  ║   Ahuva IT Support Assistant  •  Installer       ║" -ForegroundColor Cyan
    Write-Host "  ║   v$Version  •  Windows                              ║" -ForegroundColor Cyan
    Write-Host "  ╚══════════════════════════════════════════════════╝" -ForegroundColor Cyan
    Write-Host ""
}

Write-Banner

# ── 1. Git ───────────────────────────────────────────────────────────────────
Write-Step "1/6" "Checking Git..."
$git = Get-Command git -ErrorAction SilentlyContinue
if (-not $git) {
    Write-Info "Git not found — installing via winget..."
    try {
        winget install --id Git.Git -e --source winget --silent --accept-package-agreements --accept-source-agreements
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                    [System.Environment]::GetEnvironmentVariable("Path", "User")
        $git = Get-Command git -ErrorAction SilentlyContinue
        if (-not $git) { throw "git still not found after winget install" }
    } catch {
        Write-Fail "Could not auto-install Git."
        Write-Fail "Please download from https://git-scm.com/download/win and re-run."
        exit 1
    }
}
Write-OK "git $(& git --version 2>&1)"

# ── 2. Node.js ───────────────────────────────────────────────────────────────
Write-Step "2/6" "Checking Node.js (need >= 20)..."
$node = Get-Command node -ErrorAction SilentlyContinue
$needNode = $true
if ($node) {
    $ver = (& node --version 2>&1) -replace "v",""
    $major = [int]($ver.Split(".")[0])
    if ($major -ge 20) { $needNode = $false; Write-OK "Node.js v$ver" }
    else { Write-Info "Node.js v$ver is too old — installing latest LTS..." }
}
if ($needNode) {
    Write-Info "Installing Node.js LTS via winget..."
    try {
        winget install --id OpenJS.NodeJS.LTS -e --source winget --silent --accept-package-agreements --accept-source-agreements
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                    [System.Environment]::GetEnvironmentVariable("Path", "User")
        $ver = (& node --version 2>&1) -replace "v",""
        Write-OK "Node.js v$ver"
    } catch {
        Write-Fail "Could not auto-install Node.js."
        Write-Fail "Please download Node.js 20 LTS from https://nodejs.org and re-run."
        exit 1
    }
}

# ── 3. Clone / update ────────────────────────────────────────────────────────
Write-Step "3/6" "Installing app to $InstallDir ..."
if (Test-Path "$InstallDir\.git") {
    Write-Info "Existing install found — pulling latest changes..."
    & git -C "$InstallDir" pull --ff-only 2>&1 | Out-Null
    Write-OK "Updated to latest"
} else {
    if (Test-Path $InstallDir) { Remove-Item $InstallDir -Recurse -Force }
    & git clone $RepoUrl $InstallDir 2>&1 | Select-String "Cloning|done|error" | ForEach-Object { Write-Info $_ }
    Write-OK "Cloned repository"
}

# ── 4. npm install ───────────────────────────────────────────────────────────
Write-Step "4/6" "Installing dependencies (this takes ~1 min first time)..."
Set-Location $InstallDir

# Configure npm to accept build scripts for known trusted packages
$approveList = @("electron", "ssh2", "cpu-features", "@serialport/bindings-cpp")
foreach ($pkg in $approveList) {
    $null = & npm pkg set "allowScripts.$pkg=true" 2>&1
}

$npmOut = & npm install --prefer-offline 2>&1
$lastLines = $npmOut | Select-Object -Last 4
$lastLines | ForEach-Object { Write-Info $_ }

if ($LASTEXITCODE -ne 0) {
    Write-Info "Retrying without offline cache..."
    & npm install 2>&1 | Select-Object -Last 4 | ForEach-Object { Write-Info $_ }
}
Write-OK "Dependencies installed"

# ── 5. Packet capture (optional — Npcap) ─────────────────────────────────────
Write-Step "5/6" "Checking packet capture support..."
$tshark = Get-Command tshark -ErrorAction SilentlyContinue
if ($tshark) {
    Write-OK "tshark found at $($tshark.Source)"
} else {
    $npcapCheck = Get-ItemProperty "HKLM:\SOFTWARE\WOW6432Node\Npcap" -ErrorAction SilentlyContinue
    if ($npcapCheck) {
        Write-Info "Npcap installed but tshark not in PATH."
        Write-Info "Install Wireshark from https://www.wireshark.org and tshark will be available."
    } else {
        Write-Host ""
        Write-Host "  ┌─ Packet Capture Setup (optional) ──────────────────────┐" -ForegroundColor Yellow
        Write-Host "  │  For local traffic capture you need:                    │" -ForegroundColor Yellow
        Write-Host "  │   • Wireshark  →  https://www.wireshark.org             │" -ForegroundColor Yellow
        Write-Host "  │     (tick 'Install Npcap' and 'Install tshark' during   │" -ForegroundColor Yellow
        Write-Host "  │      setup)                                              │" -ForegroundColor Yellow
        Write-Host "  │  The app will still work without it — use On-device     │" -ForegroundColor Yellow
        Write-Host "  │  Capture to run the switch's built-in sniffer instead.  │" -ForegroundColor Yellow
        Write-Host "  └─────────────────────────────────────────────────────────┘" -ForegroundColor Yellow
        Write-Host ""
    }
}

# ── 6. Shortcuts ─────────────────────────────────────────────────────────────
Write-Step "6/6" "Creating shortcuts..."

# Launcher batch file (no flashing console window trick — use a vbs wrapper)
$batPath = "$InstallDir\launch.bat"
$vbsPath = "$InstallDir\launch.vbs"
Set-Content -Path $batPath -Value "@echo off`r`ncd /d `"$InstallDir`"`r`nnpm start" -Encoding ASCII
Set-Content -Path $vbsPath -Encoding ASCII -Value @"
Set ws = CreateObject("WScript.Shell")
ws.Run Chr(34) & "$batPath" & Chr(34), 0, False
"@

$wsh = New-Object -ComObject WScript.Shell

# Desktop
$desk = $wsh.CreateShortcut("$env:USERPROFILE\Desktop\$AppName.lnk")
$desk.TargetPath       = $vbsPath
$desk.WorkingDirectory = $InstallDir
$desk.Description      = "$AppName v$Version"
if (Test-Path "$InstallDir\assets\icon.ico") { $desk.IconLocation = "$InstallDir\assets\icon.ico" }
$desk.Save()

# Start Menu
$smDir = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs"
$sm = $wsh.CreateShortcut("$smDir\$AppName.lnk")
$sm.TargetPath       = $vbsPath
$sm.WorkingDirectory = $InstallDir
$sm.Description      = "$AppName v$Version"
if (Test-Path "$InstallDir\assets\icon.ico") { $sm.IconLocation = "$InstallDir\assets\icon.ico" }
$sm.Save()

Write-OK "Desktop + Start Menu shortcuts created"

# ── Done ─────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ╔══════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "  ║   Installation complete!                         ║" -ForegroundColor Green
Write-Host "  ╚══════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "  Launch options:" -ForegroundColor White
Write-Host "    • Double-click  '$AppName'  on Desktop" -ForegroundColor Cyan
Write-Host "    • Start Menu → $AppName" -ForegroundColor Cyan
Write-Host "    • Run manually:" -ForegroundColor Cyan
Write-Host "        cd `"$InstallDir`"  &&  npm start" -ForegroundColor Cyan
Write-Host ""
Write-Host "  To update later, re-run this script — it will git pull + reinstall." -ForegroundColor Gray
Write-Host ""

$launch = Read-Host "  Launch now? [Y/n]"
if ($launch -ne "n" -and $launch -ne "N") {
    Start-Process "wscript.exe" "`"$vbsPath`""
    Write-Host "  Launching..." -ForegroundColor Green
}
Write-Host ""
