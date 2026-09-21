#!/data/data/com.termux/files/usr/bin/bash
# Ahuva IT Support Assistant — Termux (Android) Installer v1.7.0
# ─────────────────────────────────────────────────────────────────────────────
# ONE-LINER (paste into Termux):
#   curl -fsSL "https://raw.githubusercontent.com/enoshvarma/ahuva-it-support-assistant/main/scripts/install-termux.sh" | bash
#
# Or after cloning:
#   bash scripts/install-termux.sh
#
# Requirements: Termux from F-Droid (Play Store version is outdated)
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

APP_NAME="Ahuva IT Support Assistant"
REPO_URL="https://github.com/enoshvarma/ahuva-it-support-assistant.git"
INSTALL_DIR="$HOME/ahuva-it-assistant"
BIN_DIR="$PREFIX/bin"
BIN_LINK="$BIN_DIR/ahuva"
VERSION="1.7.0"

# ── Colours ──────────────────────────────────────────────────────────────────
C='\033[0;36m'; G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; W='\033[0m'
step()  { echo -e "\n${Y}  [$1] $2${W}"; }
ok()    { echo -e "${G}      OK  $1${W}"; }
info()  { echo -e "${C}      ->  $1${W}"; }
fail()  { echo -e "${R}      !!  $1${W}"; }

# ── Check Termux environment ────────────────────────────────────────────────
if [ ! -d "/data/data/com.termux" ] && [ -z "$TERMUX_VERSION" ]; then
    fail "This script is designed for Termux on Android."
    fail "Install Termux from F-Droid: https://f-droid.org/packages/com.termux/"
    exit 1
fi

# ── Banner ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${C}  ╔══════════════════════════════════════════════════╗${W}"
echo -e "${C}  ║   Ahuva IT Support Assistant  •  Termux          ║${W}"
echo -e "${C}  ║   v${VERSION}  •  Android / Termux                    ║${W}"
echo -e "${C}  ╚══════════════════════════════════════════════════╝${W}"
echo ""

# ── 1. Update Termux packages ───────────────────────────────────────────────
step "1/7" "Updating Termux packages..."
pkg update -y 2>&1 | tail -3
pkg upgrade -y 2>&1 | tail -3
ok "Packages up to date"

# ── 2. Git ───────────────────────────────────────────────────────────────────
step "2/7" "Checking Git..."
if ! command -v git &>/dev/null; then
    info "Installing git..."
    pkg install -y git 2>&1 | tail -2
fi
ok "$(git --version)"

# ── 3. Node.js ───────────────────────────────────────────────────────────────
step "3/7" "Checking Node.js..."
if ! command -v node &>/dev/null; then
    info "Installing Node.js..."
    pkg install -y nodejs-lts 2>&1 | tail -2
fi

node_ver=$(node --version | tr -d 'v')
node_major=$(echo "$node_ver" | cut -d. -f1)
if [ "$node_major" -lt 18 ]; then
    info "Node.js too old (v$node_ver). Upgrading..."
    pkg install -y nodejs-lts 2>&1 | tail -2
fi
ok "Node.js $(node --version)"

# ── 4. Build tools (for native modules) ─────────────────────────────────────
step "4/7" "Installing build tools..."
pkg install -y python make clang binutils 2>&1 | tail -3
ok "Build tools ready"

# ── 5. Optional tools ───────────────────────────────────────────────────────
step "5/7" "Installing network tools..."
# openssh for SSH client, nmap for enhanced scanning, net-tools for arp
for tool in openssh nmap net-tools iproute2 traceroute; do
    if ! dpkg -s "$tool" &>/dev/null 2>&1; then
        pkg install -y "$tool" 2>&1 | tail -1 || true
    fi
done
ok "Network tools installed"

# ── 6. Clone / update ───────────────────────────────────────────────────────
step "6/7" "Installing to $INSTALL_DIR ..."
if [ -d "$INSTALL_DIR/.git" ]; then
    info "Existing install found — pulling latest..."
    git -C "$INSTALL_DIR" pull --ff-only 2>&1 | tail -2
    ok "Updated to latest"
else
    [ -d "$INSTALL_DIR" ] && rm -rf "$INSTALL_DIR"
    git clone "$REPO_URL" "$INSTALL_DIR"
    ok "Repository cloned"
fi

# ── 7. npm install (skip Electron — CLI mode only) ──────────────────────────
step "7/7" "Installing dependencies (CLI mode — no Electron)..."
cd "$INSTALL_DIR"

# Install only production deps needed for CLI (skip electron, electron-builder)
npm install --omit=dev --ignore-scripts 2>&1 | tail -3

# Install ssh2 native bindings (needed for SSH connections)
npm install ssh2 2>&1 | tail -3 || info "ssh2 install had warnings (may still work)"

ok "Dependencies installed"

# ── Create launcher ─────────────────────────────────────────────────────────
mkdir -p "$BIN_DIR"
cat > "$BIN_LINK" <<LAUNCHEOF
#!/data/data/com.termux/files/usr/bin/bash
cd "$INSTALL_DIR"
exec node cli.js "\$@"
LAUNCHEOF
chmod +x "$BIN_LINK"
ok "Launcher created at: ahuva"

# ── Termux:API setup hint (optional, for USB serial) ────────────────────────
echo ""
echo -e "${Y}  ┌─ USB Serial Support (optional) ──────────────────────┐${W}"
echo -e "${Y}  │  For USB OTG serial console (console cables):        │${W}"
echo -e "${Y}  │                                                      │${W}"
echo -e "${C}  │  1. Install Termux:API from F-Droid                  │${W}"
echo -e "${C}  │  2. pkg install termux-api                           │${W}"
echo -e "${C}  │  3. Grant USB permissions when prompted               │${W}"
echo -e "${Y}  │                                                      │${W}"
echo -e "${Y}  │  Serial ports appear at /dev/ttyUSB0 or /dev/bus/usb │${W}"
echo -e "${Y}  └──────────────────────────────────────────────────────┘${W}"
echo ""

# ── Termux storage setup hint ────────────────────────────────────────────────
echo -e "${Y}  ┌─ Storage Access (recommended) ────────────────────────┐${W}"
echo -e "${Y}  │  To save configs/backups to your phone storage:       │${W}"
echo -e "${C}  │  termux-setup-storage                                 │${W}"
echo -e "${Y}  │  Then use ~/storage/shared/ to access Downloads etc.  │${W}"
echo -e "${Y}  └──────────────────────────────────────────────────────┘${W}"
echo ""

# ── Done ─────────────────────────────────────────────────────────────────────
echo -e "${G}  ╔══════════════════════════════════════════════════╗${W}"
echo -e "${G}  ║   Installation complete!                         ║${W}"
echo -e "${G}  ╚══════════════════════════════════════════════════╝${W}"
echo ""
echo -e "  Launch:  ${C}ahuva${W}"
echo -e "  Or:      ${C}cd $INSTALL_DIR && node cli.js${W}"
echo ""
echo -e "  To update later, re-run this script or:"
echo -e "  ${C}cd $INSTALL_DIR && git pull && npm install --omit=dev${W}"
echo ""

read -rp "  Launch now? [Y/n] " launch
if [[ "${launch:-Y}" != "n" && "${launch:-Y}" != "N" ]]; then
    exec node "$INSTALL_DIR/cli.js"
fi
echo ""
