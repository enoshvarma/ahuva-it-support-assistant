# Ahuva IT Support Assistant -- Windows Installer v1.8.0
# -------------------------------------------------------------------------
# ONE-LINER (paste into any PowerShell or CMD window -- no admin needed):
#
#   PowerShell:
#     irm https://raw.githubusercontent.com/enoshvarma/ahuva-it-support-assistant/main/scripts/install-windows.ps1 | iex
#
#   CMD (command prompt):
#     powershell -ExecutionPolicy Bypass -Command "irm 'https://raw.githubusercontent.com/enoshvarma/ahuva-it-support-assistant/main/scripts/install-windows.ps1' | iex"
#
# What this script does:
#   1. Installs Git (via winget) if missing
#   2. Installs Node.js LTS (via winget) if missing or < v20
#   3. Clones / updates the repo to %LOCALAPPDATA%\AhuvaITAssistant
#   4. Runs npm install
#   5. Registers app in Control Panel (Add/Remove Programs)
#   6. Creates Desktop shortcut + Start Menu entry
#   7. Launches the app
# -------------------------------------------------------------------------

$ErrorActionPreference = "Stop"

$AppName    = "Ahuva IT Support Assistant"
$RepoUrl    = "https://github.com/enoshvarma/ahuva-it-support-assistant.git"
$InstallDir = "$env:LOCALAPPDATA\AhuvaITAssistant"
$Version    = "1.8.0"

# -- colour helpers -----------------------------------------------------------
function Write-Step   { param($n,$t) Write-Host "  [$n] $t" -ForegroundColor Yellow }
function Write-OK     { param($t)    Write-Host "      OK  $t" -ForegroundColor Green }
function Write-Info   { param($t)    Write-Host "      ->  $t" -ForegroundColor Cyan }
function Write-Fail   { param($t)    Write-Host "      !!  $t" -ForegroundColor Red }
function Write-Banner {
    Write-Host ""
    Write-Host "  +==================================================+" -ForegroundColor Cyan
    Write-Host "  |   Ahuva IT Support Assistant  |  Installer v1.8  |" -ForegroundColor Cyan
    Write-Host "  |   Windows  |  7 steps  |  no admin needed         |" -ForegroundColor Cyan
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
Write-Step "4/6" "Installing dependencies (2-3 min on first run)..."
Set-Location $InstallDir

$electronExe = "$InstallDir\node_modules\electron\dist\electron.exe"

# If a previous install left node_modules in a broken state (electron binary
# missing, or a sub-dependency like fs-extra is corrupted), wipe and start fresh.
$needsClean = $false
if (Test-Path "$InstallDir\node_modules") {
    if (-not (Test-Path $electronExe)) { $needsClean = $true }
    elseif (-not (Test-Path "$InstallDir\node_modules\fs-extra\lib\index.js")) { $needsClean = $true }
}
if ($needsClean) {
    Write-Info "Incomplete previous install detected -- cleaning node_modules..."
    Remove-Item "$InstallDir\node_modules" -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item "$InstallDir\package-lock.json" -Force -ErrorAction SilentlyContinue
    Write-OK "Cleaned"
}

Write-Info "Running npm install..."
$prevEAP = $ErrorActionPreference; $ErrorActionPreference = "SilentlyContinue"
& npm install 2>&1 | Select-Object -Last 6 | ForEach-Object { Write-Info $_ }
$npmExit = $LASTEXITCODE
$ErrorActionPreference = $prevEAP

# If npm install failed OR electron binary still missing, do a full clean retry
if ($npmExit -ne 0 -or -not (Test-Path $electronExe)) {
    Write-Info "npm install did not complete cleanly (exit $npmExit) -- retrying with clean slate..."
    Remove-Item "$InstallDir\node_modules"    -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item "$InstallDir\package-lock.json" -Force  -ErrorAction SilentlyContinue
    $prevEAP = $ErrorActionPreference; $ErrorActionPreference = "SilentlyContinue"
    & npm install --legacy-peer-deps 2>&1 | Select-Object -Last 6 | ForEach-Object { Write-Info $_ }
    $ErrorActionPreference = $prevEAP
}

if (Test-Path $electronExe) {
    Write-OK "Dependencies installed + Electron binary ready"
} else {
    Write-Info "WARNING: Electron binary not found after install."
    Write-Info "Check your internet connection -- the installer will try .cmd fallback."
}

# -- 5. Packet capture (optional -- Npcap) ------------------------------------
Write-Step "5/7" "Checking packet capture support..."
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

# -- 6. Shortcuts + Control Panel ---------------------------------------------
Write-Step "6/7" "Creating shortcuts..."

# Batch launcher — tries three paths in order so it always works
$batPath = "$InstallDir\launch.bat"
Set-Content -Path $batPath -Encoding ASCII -Value @"
@echo off
cd /d "$InstallDir"
if exist "node_modules\electron\dist\electron.exe" (
    "node_modules\electron\dist\electron.exe" . --disable-gpu-sandbox --no-sandbox
    goto :done
)
if exist "node_modules\.bin\electron.cmd" (
    "node_modules\.bin\electron.cmd" . --disable-gpu-sandbox --no-sandbox
    goto :done
)
echo Electron not found -- running npm install...
call npm install
"node_modules\.bin\electron.cmd" . --disable-gpu-sandbox --no-sandbox
:done
if errorlevel 1 pause
"@

# VBS wrapper: runs the bat with no visible console window.
$vbsPath = "$InstallDir\launch.vbs"
Set-Content -Path $vbsPath -Encoding ASCII -Value @"
Set ws = CreateObject("WScript.Shell")
ws.Run Chr(34) & "$batPath" & Chr(34), 7, False
"@

$wsh = New-Object -ComObject WScript.Shell

# Use the shell-known folder so OneDrive-redirected desktops work correctly
$desktopPath = $wsh.SpecialFolders("Desktop")
$desk = $wsh.CreateShortcut("$desktopPath\$AppName.lnk")
$desk.TargetPath       = $vbsPath
$desk.WorkingDirectory = $InstallDir
$desk.Description      = "$AppName v$Version"
if (Test-Path "$InstallDir\assets\icon.ico") { $desk.IconLocation = "$InstallDir\assets\icon.ico" }
$desk.Save()
Write-OK "Desktop shortcut -> $desktopPath\$AppName.lnk"

$smDir = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs"
$sm = $wsh.CreateShortcut("$smDir\$AppName.lnk")
$sm.TargetPath       = $vbsPath
$sm.WorkingDirectory = $InstallDir
$sm.Description      = "$AppName v$Version"
if (Test-Path "$InstallDir\assets\icon.ico") { $sm.IconLocation = "$InstallDir\assets\icon.ico" }
$sm.Save()
Write-OK "Start Menu shortcut created"

# -- 7. Control Panel (Add/Remove Programs) -----------------------------------
Write-Step "7/7" "Registering in Control Panel..."
$uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\AhuvaITAssistant"
$uninstallCmd = "powershell -ExecutionPolicy Bypass -Command `"Remove-Item '$InstallDir' -Recurse -Force; Remove-Item '$desktopPath\$AppName.lnk' -Force -ErrorAction SilentlyContinue; Remove-Item '$smDir\$AppName.lnk' -Force -ErrorAction SilentlyContinue; Remove-Item 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\AhuvaITAssistant' -Recurse -Force -ErrorAction SilentlyContinue`""
try {
    if (-not (Test-Path $uninstallKey)) { $null = New-Item -Path $uninstallKey -Force }
    Set-ItemProperty -Path $uninstallKey -Name "DisplayName"      -Value $AppName
    Set-ItemProperty -Path $uninstallKey -Name "DisplayVersion"   -Value $Version
    Set-ItemProperty -Path $uninstallKey -Name "Publisher"        -Value "Ahuva IT"
    Set-ItemProperty -Path $uninstallKey -Name "InstallLocation"  -Value $InstallDir
    Set-ItemProperty -Path $uninstallKey -Name "UninstallString"  -Value $uninstallCmd
    Set-ItemProperty -Path $uninstallKey -Name "NoModify"         -Value 1 -Type DWord
    Set-ItemProperty -Path $uninstallKey -Name "NoRepair"         -Value 1 -Type DWord
    if (Test-Path "$InstallDir\assets\icon.ico") {
        Set-ItemProperty -Path $uninstallKey -Name "DisplayIcon" -Value "$InstallDir\assets\icon.ico"
    }
    Write-OK "Registered in Control Panel -> Add/Remove Programs"
} catch {
    Write-Info "Could not write registry entry (non-fatal): $_"
}

# -- Done ---------------------------------------------------------------------
Write-Host ""
Write-Host "  +==================================================+" -ForegroundColor Green
Write-Host "  |   Installation complete!  v$Version                   |" -ForegroundColor Green
Write-Host "  +==================================================+" -ForegroundColor Green
Write-Host ""
Write-Host "  Launch options:" -ForegroundColor White
Write-Host "    * Desktop shortcut: '$AppName'" -ForegroundColor Cyan
Write-Host "    * Start -> $AppName" -ForegroundColor Cyan
Write-Host "    * Uninstall: Control Panel -> Add/Remove Programs -> $AppName" -ForegroundColor Cyan
Write-Host "    * Update:    re-run this one-liner at any time" -ForegroundColor Cyan
Write-Host ""

Write-Host "  Launching app..." -ForegroundColor Green
Start-Process "wscript.exe" "`"$vbsPath`""
Write-Host ""
