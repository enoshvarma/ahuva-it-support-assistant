#!/usr/bin/env bash
# Ahuva IT Support Assistant — macOS Installer v1.6.0
# ─────────────────────────────────────────────────────────────────────────────
# ONE-LINER:
#   curl -fsSL "https://raw.githubusercontent.com/enoshvarma/ahuva-it-support-assistant/main/scripts/install-mac.sh" | bash
#
# Or after cloning:
#   bash scripts/install-mac.sh
#
# Requirements: macOS 12 Monterey or later  |  Intel or Apple Silicon
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

APP_NAME="Ahuva IT Support Assistant"
REPO_URL="https://github.com/enoshvarma/ahuva-it-support-assistant.git"
INSTALL_DIR="$HOME/Applications/AhuvaITAssistant"
VERSION="1.6.0"

# ── Colours ──────────────────────────────────────────────────────────────────
C='\033[0;36m'; G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; W='\033[0m'
step()  { echo -e "\n${Y}  [$1] $2${W}"; }
ok()    { echo -e "${G}      OK  $1${W}"; }
info()  { echo -e "${C}      ->  $1${W}"; }
fail()  { echo -e "${R}      !!  $1${W}"; }

# ── Detect Apple Silicon vs Intel ────────────────────────────────────────────
ARCH=$(uname -m)
if [[ "$ARCH" == "arm64" ]]; then
    BREW_PREFIX="/opt/homebrew"
else
    BREW_PREFIX="/usr/local"
fi
export PATH="$BREW_PREFIX/bin:$BREW_PREFIX/sbin:$PATH"

# ── Banner ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${C}  ╔══════════════════════════════════════════════════╗${W}"
echo -e "${C}  ║   Ahuva IT Support Assistant  •  Installer       ║${W}"
echo -e "${C}  ║   v${VERSION}  •  macOS ($ARCH)                       ║${W}"
echo -e "${C}  ╚══════════════════════════════════════════════════╝${W}"
echo ""

# ── 1. Homebrew ──────────────────────────────────────────────────────────────
step "1/6" "Checking Homebrew..."
if ! command -v brew &>/dev/null; then
    info "Installing Homebrew (you may be prompted for your password)..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    # Reload PATH so the new brew is found
    export PATH="$BREW_PREFIX/bin:$BREW_PREFIX/sbin:$PATH"
fi
ok "$(brew --version | head -1)"

# ── 2. Git ───────────────────────────────────────────────────────────────────
step "2/6" "Checking Git..."
if ! command -v git &>/dev/null; then
    info "Installing git via Homebrew..."
    brew install git
fi
ok "$(git --version)"

# ── 3. Node.js >= 20 ─────────────────────────────────────────────────────────
step "3/6" "Checking Node.js (need >= 20)..."
need_node=true
if command -v node &>/dev/null; then
    node_ver=$(node --version | tr -d 'v')
    node_major=$(echo "$node_ver" | cut -d. -f1)
    if [[ "$node_major" -ge 20 ]]; then
        need_node=false
        ok "Node.js v$node_ver"
    else
        info "Node.js v$node_ver is too old — installing latest LTS..."
    fi
fi
if $need_node; then
    info "Installing Node.js LTS via Homebrew..."
    brew install node@20 2>/dev/null || brew upgrade node@20 2>/dev/null || true
    # Link it (may already be linked)
    brew link node@20 --force --overwrite 2>/dev/null || true
    export PATH="$BREW_PREFIX/opt/node@20/bin:$PATH"
    ok "Node.js $(node --version)"
fi

# ── 4. Clone / update ────────────────────────────────────────────────────────
step "4/6" "Installing to $INSTALL_DIR ..."
mkdir -p "$(dirname "$INSTALL_DIR")"
if [[ -d "$INSTALL_DIR/.git" ]]; then
    info "Existing install found — pulling latest..."
    git -C "$INSTALL_DIR" pull --ff-only
    ok "Updated to latest"
else
    [[ -d "$INSTALL_DIR" ]] && rm -rf "$INSTALL_DIR"
    git clone "$REPO_URL" "$INSTALL_DIR"
    ok "Repository cloned"
fi

# ── 5. npm install ───────────────────────────────────────────────────────────
step "5/6" "Installing dependencies (takes ~1 min first time)..."
cd "$INSTALL_DIR"
npm install --prefer-offline 2>&1 | tail -3
ok "Dependencies installed"

# ── 6. tshark / Wireshark ────────────────────────────────────────────────────
step "6/6" "Setting up packet capture (optional)..."
if command -v tshark &>/dev/null; then
    ok "tshark $(tshark --version 2>&1 | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')"
else
    echo ""
    echo -e "${Y}  ┌─ Packet Capture Setup (optional) ──────────────────────┐${W}"
    echo -e "${Y}  │  Install Wireshark to enable local packet capture:      │${W}"
    echo -e "${Y}  │                                                          │${W}"
    echo -e "${Y}  │    brew install --cask wireshark                         │${W}"
    echo -e "${Y}  │                                                          │${W}"
    echo -e "${Y}  │  Then allow tshark to capture without sudo:              │${W}"
    echo -e "${Y}  │    sudo chmod o+r /dev/bpf*                              │${W}"
    echo -e "${Y}  │                                                          │${W}"
    echo -e "${Y}  │  The app works without it — use On-device Capture to    │${W}"
    echo -e "${Y}  │  run the switch's built-in sniffer instead.              │${W}"
    echo -e "${Y}  └──────────────────────────────────────────────────────────┘${W}"
    echo ""
fi

# ── Desktop launcher ─────────────────────────────────────────────────────────
LAUNCHER="$INSTALL_DIR/launch.command"
cat > "$LAUNCHER" <<LAUNCHEOF
#!/usr/bin/env bash
cd "$INSTALL_DIR"
npm start
LAUNCHEOF
chmod +x "$LAUNCHER"

# Desktop symlink
DESKTOP="$HOME/Desktop/$APP_NAME.command"
[[ -L "$DESKTOP" || -f "$DESKTOP" ]] && rm -f "$DESKTOP"
ln -s "$LAUNCHER" "$DESKTOP"

# ── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo -e "${G}  ╔══════════════════════════════════════════════════╗${W}"
echo -e "${G}  ║   Installation complete!                         ║${W}"
echo -e "${G}  ╚══════════════════════════════════════════════════╝${W}"
echo ""
echo -e "  Launch options:"
echo -e "${C}    • Double-click  '$APP_NAME.command'  on your Desktop${W}"
echo -e "      (first time: right-click → Open → Open to bypass Gatekeeper)"
echo -e "${C}    • Or run:  cd \"$INSTALL_DIR\" && npm start${W}"
echo ""
echo -e "  To update later, re-run this script."
echo ""

read -rp "  Launch now? [Y/n] " launch
if [[ "${launch:-Y}" != "n" && "${launch:-Y}" != "N" ]]; then
    open "$LAUNCHER"
    echo -e "${G}  Launching...${W}"
fi
echo ""
