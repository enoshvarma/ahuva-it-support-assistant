# Ahuva IT Support Assistant — Windows Installer
# Run from PowerShell as Administrator:
#   powershell -ExecutionPolicy Bypass -File install-windows.ps1
# Or right-click → "Run with PowerShell"

$ErrorActionPreference = "Stop"
$AppName   = "Ahuva IT Support Assistant"
$RepoUrl   = "https://github.com/enoshvarma/ahuva-it-support-assistant.git"
$InstallTo = "$env:LOCALAPPDATA\AhuvaITAssistant"

Write-Host ""
Write-Host "  ╔══════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "  ║   Ahuva IT Support Assistant Installer   ║" -ForegroundColor Cyan
Write-Host "  ╚══════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# ── 1. Check git ────────────────────────────────────────────────
Write-Host "[1/5] Checking prerequisites..." -ForegroundColor Yellow
$git = Get-Command git -ErrorAction SilentlyContinue
if (-not $git) {
    Write-Host "  ✗  git not found. Install from https://git-scm.com/ and re-run." -ForegroundColor Red
    exit 1
}
Write-Host "  ✓  git $(& git --version)" -ForegroundColor Green

# ── 2. Check Node.js ────────────────────────────────────────────
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host "  ✗  Node.js not found." -ForegroundColor Red
    Write-Host "     Download from https://nodejs.org (LTS, 20+) and re-run." -ForegroundColor Red
    exit 1
}
$nodeVer = & node --version
Write-Host "  ✓  Node.js $nodeVer" -ForegroundColor Green

# ── 3. Clone / update ───────────────────────────────────────────
Write-Host "[2/5] Installing app to $InstallTo ..." -ForegroundColor Yellow
if (Test-Path "$InstallTo\.git") {
    Write-Host "  → Updating existing install..." -ForegroundColor Cyan
    Set-Location $InstallTo
    & git pull --ff-only
} else {
    if (Test-Path $InstallTo) { Remove-Item $InstallTo -Recurse -Force }
    & git clone $RepoUrl $InstallTo
    Set-Location $InstallTo
}
Write-Host "  ✓  Source ready" -ForegroundColor Green

# ── 4. npm install ──────────────────────────────────────────────
Write-Host "[3/5] Installing dependencies (this takes ~1 min)..." -ForegroundColor Yellow
& npm install --prefer-offline 2>&1 | Out-Null
# Approve native build scripts silently
& npm approve-scripts electron ssh2 cpu-features "@serialport/bindings-cpp" 2>&1 | Out-Null
& npm install 2>&1 | Select-Object -Last 3
Write-Host "  ✓  Dependencies installed" -ForegroundColor Green

# ── 5. Create shortcuts ─────────────────────────────────────────
Write-Host "[4/5] Creating shortcuts..." -ForegroundColor Yellow
$target = "$InstallTo\node_modules\.bin\electron.cmd"
$workDir = $InstallTo
$WshShell = New-Object -ComObject WScript.Shell

# Desktop shortcut
$desk = $WshShell.CreateShortcut("$env:USERPROFILE\Desktop\$AppName.lnk")
$desk.TargetPath  = "cmd.exe"
$desk.Arguments   = "/c `"cd /d `"$workDir`" && npm start`""
$desk.WorkingDirectory = $workDir
$desk.Description = $AppName
$desk.WindowStyle = 7   # minimised console
$desk.Save()

# Start Menu shortcut
$startMenu = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs"
$sm = $WshShell.CreateShortcut("$startMenu\$AppName.lnk")
$sm.TargetPath  = "cmd.exe"
$sm.Arguments   = "/c `"cd /d `"$workDir`" && npm start`""
$sm.WorkingDirectory = $workDir
$sm.Description = $AppName
$sm.WindowStyle = 7
$sm.Save()
Write-Host "  ✓  Desktop + Start Menu shortcuts created" -ForegroundColor Green

# ── Done ────────────────────────────────────────────────────────
Write-Host ""
Write-Host "[5/5] Done!" -ForegroundColor Green
Write-Host ""
Write-Host "  Launch via the Desktop shortcut, Start Menu, or:" -ForegroundColor White
Write-Host "    cd `"$InstallTo`"  &&  npm start" -ForegroundColor Cyan
Write-Host ""
Write-Host "  To update later, re-run this script — it will git pull + reinstall." -ForegroundColor Gray
Write-Host ""

$launch = Read-Host "Launch now? [Y/n]"
if ($launch -ne "n" -and $launch -ne "N") {
    Start-Process "cmd.exe" "/c `"cd /d `"$InstallTo`" && npm start`""
}
