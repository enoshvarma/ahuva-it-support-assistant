# Ahuva IT Support Assistant -- Windows Installer v1.7.0
# -------------------------------------------------------------------------
# ONE-LINER (run from any PowerShell window -- no admin needed):
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
# -------------------------------------------------------------------------

$ErrorActionPreference = "Stop"

$AppName    = "Ahuva IT Support Assistant"
$RepoUrl    = "https://github.com/enoshvarma/ahuva-it-support-assistant.git"
$InstallDir = "$env:LOCALAPPDATA\AhuvaITAssistant"
$Version    = "1.7.0"

# -- colour helpers -----------------------------------------------------------
function Write-Step   { param($n,$t) Write-Host "  [$n] $t" -ForegroundColor Yellow }
function Write-OK     { param($t)    Write-Host "      OK  $t" -ForegroundColor Green }
function Write-Info   { param($t)    Write-Host "      ->  $t" -ForegroundColor Cyan }
function Write-Fail   { param($t)    Write-Host "      !!  $t" -ForegroundColor Red }
function Write-Banner {
    Write-Host ""
    Write-Host "  +==================================================+" -ForegroundColor Cyan
    Write-Host "  |   Ahuva IT Support Assistant  |  Installer        |" -ForegroundColor Cyan
    Write-Host "  |   v$Version  |  Windows                               |" -ForegroundColor Cyan
    Write-Host "  +==================================================+" -ForegroundColor Cyan
    Write-Host ""
}

# Run a native git command silently and throw on non-zero exit.
# Works around PowerShell 5.1 treating native stderr as ErrorRecord.
function Invoke-Git {
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    $null = & git @args
    $code = $LASTEXITCODE
    $ErrorActionPreference = $prevEAP
    if ($code -ne 0) { throw "git $($args[0]) failed (exit $code)" }
}

Write-Banner

# -- 1. Git -------------------------------------------------------------------
Write-Step "1/6" "Checking Git..."
$git = Get-Command git -ErrorAction SilentlyContinue
if (-not $git) {
    Write-Info "Git not found -- installing via winget..."
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
$prevEAP = $ErrorActionPreference; $ErrorActionPreference = "SilentlyContinue"
$gitVer = (& git --version) -join ""
$ErrorActionPreference = $prevEAP
Write-OK $gitVer

# -- 2. Node.js ---------------------------------------------------------------
Write-Step "2/6" "Checking Node.js (need >= 20)..."
$node = Get-Command node -ErrorAction SilentlyContinue
$needNode = $true
if ($node) {
    $prevEAP = $ErrorActionPreference; $ErrorActionPreference = "SilentlyContinue"
    $verStr = (& node --version) -join "" -replace "v",""
    $ErrorActionPreference = $prevEAP
    $major = [int]($verStr.Split(".")[0])
    if ($major -ge 20) { $needNode = $false; Write-OK "Node.js v$verStr" }
    else { Write-Info "Node.js v$verStr is too old -- installing latest LTS..." }
}
if ($needNode) {
    Write-Info "Installing Node.js LTS via winget..."
    try {
        winget install --id OpenJS.NodeJS.LTS -e --source winget --silent --accept-package-agreements --accept-source-agreements
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                    [System.Environment]::GetEnvironmentVariable("Path", "User")
        $prevEAP = $ErrorActionPreference; $ErrorActionPreference = "SilentlyContinue"
        $verStr = (& node --version) -join "" -replace "v",""
        $ErrorActionPreference = $prevEAP
        Write-OK "Node.js v$verStr"
    } catch {
        Write-Fail "Could not auto-install Node.js."
        Write-Fail "Please download Node.js 20 LTS from https://nodejs.org and re-run."
        exit 1
    }
}

# -- 3. Clone / update --------------------------------------------------------
Write-Step "3/6" "Installing app to $InstallDir ..."
if (Test-Path "$InstallDir\.git") {
    Write-Info "Existing install found -- pulling latest changes..."
    try {
        Invoke-Git -C $InstallDir pull --ff-only --quiet
        Write-OK "Updated to latest"
    } catch {
        Write-Info "Fast-forward not possible; resetting to origin/main..."
        Invoke-Git -C $InstallDir fetch origin
        Invoke-Git -C $InstallDir reset --hard origin/main
        Write-OK "Reset to origin/main"
    }
} else {
    if (Test-Path $InstallDir) { Remove-Item $InstallDir -Recurse -Force }
    Write-Info "Cloning repository..."
    Invoke-Git clone $RepoUrl $InstallDir --quiet
    Write-OK "Cloned repository"
}

# -- 4. npm install -----------------------------------------------------------
Write-Step "4/6" "Installing dependencies (this takes ~1 min first time)..."
Set-Location $InstallDir

$approveList = @("electron", "ssh2", "cpu-features", "@serialport/bindings-cpp")
foreach ($pkg in $approveList) {
    $null = & npm pkg set "allowScripts.$pkg=true" 2>$null
}

$prevEAP = $ErrorActionPreference; $ErrorActionPreference = "SilentlyContinue"
$npmOut = & npm install --prefer-offline 2>&1
$ErrorActionPreference = $prevEAP
$npmOut | Select-Object -Last 4 | ForEach-Object { Write-Info $_ }

if ($LASTEXITCODE -ne 0) {
    Write-Info "Retrying without offline cache..."
    $prevEAP = $ErrorActionPreference; $ErrorActionPreference = "SilentlyContinue"
    & npm install 2>&1 | Select-Object -Last 4 | ForEach-Object { Write-Info $_ }
    $ErrorActionPreference = $prevEAP
}
Write-OK "Dependencies installed"

# -- 5. Packet capture (optional -- Npcap) ------------------------------------
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
        Write-Host "  +-- Packet Capture Setup (optional) ----------------------+" -ForegroundColor Yellow
        Write-Host "  |  For local traffic capture you need:                    |" -ForegroundColor Yellow
        Write-Host "  |   * Wireshark  ->  https://www.wireshark.org            |" -ForegroundColor Yellow
        Write-Host "  |     (tick 'Install Npcap' and 'Install tshark' during   |" -ForegroundColor Yellow
        Write-Host "  |      setup)                                              |" -ForegroundColor Yellow
        Write-Host "  |  The app still works without it -- use On-device        |" -ForegroundColor Yellow
        Write-Host "  |  Capture to run the switch's built-in sniffer instead.  |" -ForegroundColor Yellow
        Write-Host "  +---------------------------------------------------------+" -ForegroundColor Yellow
        Write-Host ""
    }
}

# -- 6. Shortcuts -------------------------------------------------------------
Write-Step "6/6" "Creating shortcuts..."

# Find the electron binary directly so the launcher does NOT need npm in PATH
$electronExe = "$InstallDir\node_modules\electron\dist\electron.exe"
if (-not (Test-Path $electronExe)) {
    # Fallback: locate via node_modules/.bin (PS 5.1-compatible — no ?. operator)
    $_cmd = Get-Command "$InstallDir\node_modules\.bin\electron.cmd" -ErrorAction SilentlyContinue
    if ($_cmd) { $electronExe = $_cmd.Source }
}

# Launcher batch — runs electron directly, visible window so errors are readable.
# Falls back to `npm start` if electron.exe path was not found.
$batPath = "$InstallDir\launch.bat"
if ($electronExe -and (Test-Path $electronExe)) {
    $batContent = "@echo off`r`ncd /d `"$InstallDir`"`r`n`"$electronExe`" . --disable-gpu-sandbox --no-sandbox`r`nif errorlevel 1 pause"
} else {
    $batContent = "@echo off`r`ncd /d `"$InstallDir`"`r`ncall npm start`r`nif errorlevel 1 pause"
}
Set-Content -Path $batPath -Value $batContent -Encoding ASCII

# VBS wrapper: opens the bat invisibly.
# But if electron fails, the bat will pause (console stays open) so user can read the error.
$vbsPath = "$InstallDir\launch.vbs"
Set-Content -Path $vbsPath -Encoding ASCII -Value @"
Set ws = CreateObject("WScript.Shell")
ws.Run Chr(34) & "$batPath" & Chr(34), 7, False
"@

$wsh = New-Object -ComObject WScript.Shell

$desk = $wsh.CreateShortcut("$env:USERPROFILE\Desktop\$AppName.lnk")
$desk.TargetPath       = $vbsPath
$desk.WorkingDirectory = $InstallDir
$desk.Description      = "$AppName v$Version"
if (Test-Path "$InstallDir\assets\icon.ico") { $desk.IconLocation = "$InstallDir\assets\icon.ico" }
$desk.Save()

$smDir = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs"
$sm = $wsh.CreateShortcut("$smDir\$AppName.lnk")
$sm.TargetPath       = $vbsPath
$sm.WorkingDirectory = $InstallDir
$sm.Description      = "$AppName v$Version"
if (Test-Path "$InstallDir\assets\icon.ico") { $sm.IconLocation = "$InstallDir\assets\icon.ico" }
$sm.Save()

Write-OK "Desktop + Start Menu shortcuts created"

# -- Done ---------------------------------------------------------------------
Write-Host ""
Write-Host "  +==================================================+" -ForegroundColor Green
Write-Host "  |   Installation complete!  v$Version installed.        |" -ForegroundColor Green
Write-Host "  +==================================================+" -ForegroundColor Green
Write-Host ""
Write-Host "  Launch options:" -ForegroundColor White
Write-Host "    * Double-click  '$AppName'  on Desktop" -ForegroundColor Cyan
Write-Host "    * Start Menu -> $AppName" -ForegroundColor Cyan
Write-Host "    * Run manually:" -ForegroundColor Cyan
Write-Host "        cd `"$InstallDir`"  &&  npm start" -ForegroundColor Cyan
Write-Host ""
Write-Host "  To update later, re-run this script -- it will git pull + reinstall." -ForegroundColor Gray
Write-Host ""

$launch = Read-Host "  Launch now? [Y/n]"
if ($launch -ne "n" -and $launch -ne "N") {
    Start-Process "wscript.exe" "`"$vbsPath`""
    Write-Host "  Launching..." -ForegroundColor Green
}
Write-Host ""
