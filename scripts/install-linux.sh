#!/usr/bin/env bash
# Ahuva IT Support Assistant — Linux Installer v1.6.0
# ─────────────────────────────────────────────────────────────────────────────
# ONE-LINER:
#   curl -fsSL "https://raw.githubusercontent.com/enoshvarma/ahuva-it-support-assistant/main/scripts/install-linux.sh" | bash
#
# Or after cloning:
#   bash scripts/install-linux.sh
#
# Supported distros: Ubuntu / Debian / Linux Mint, Fedora / RHEL / CentOS,
#                    Arch / Manjaro, openSUSE, Alpine
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

APP_NAME="Ahuva IT Support Assistant"
REPO_URL="https://github.com/enoshvarma/ahuva-it-support-assistant.git"
INSTALL_DIR="$HOME/.local/share/ahuva-it-assistant"
BIN_DIR="$HOME/.local/bin"
BIN_LINK="$BIN_DIR/ahuva"
DESKTOP_DIR="$HOME/.local/share/applications"
DESKTOP_FILE="$DESKTOP_DIR/ahuva-it-assistant.desktop"
VERSION="1.6.0"

# ── Colours ──────────────────────────────────────────────────────────────────
C='\033[0;36m'; G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; W='\033[0m'
step()  { echo -e "\n${Y}  [$1] $2${W}"; }
ok()    { echo -e "${G}      OK  $1${W}"; }
info()  { echo -e "${C}      ->  $1${W}"; }
fail()  { echo -e "${R}      !!  $1${W}"; }

# ── Detect distro & package manager ──────────────────────────────────────────
PKG_MANAGER=""
if   command -v apt    &>/dev/null; then PKG_MANAGER="apt"
elif command -v dnf    &>/dev/null; then PKG_MANAGER="dnf"
elif command -v yum    &>/dev/null; then PKG_MANAGER="yum"
elif command -v pacman &>/dev/null; then PKG_MANAGER="pacman"
elif command -v zypper &>/dev/null; then PKG_MANAGER="zypper"
elif command -v apk    &>/dev/null; then PKG_MANAGER="apk"
fi

pkg_install() {
    case "$PKG_MANAGER" in
        apt)    sudo apt-get install -y "$@" ;;
        dnf)    sudo dnf install -y "$@" ;;
        yum)    sudo yum install -y "$@" ;;
        pacman) sudo pacman -S --noconfirm "$@" ;;
        zypper) sudo zypper install -y "$@" ;;
        apk)    sudo apk add --no-cache "$@" ;;
        *)      fail "Unknown package manager. Install $* manually."; return 1 ;;
    esac
}

# ── Banner ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${C}  ╔══════════════════════════════════════════════════╗${W}"
echo -e "${C}  ║   Ahuva IT Support Assistant  •  Installer       ║${W}"
echo -e "${C}  ║   v${VERSION}  •  Linux (${PKG_MANAGER:-unknown pm})                   ║${W}"
echo -e "${C}  ╚══════════════════════════════════════════════════╝${W}"
echo ""

# ── 1. Git ───────────────────────────────────────────────────────────────────
step "1/6" "Checking Git..."
if ! command -v git &>/dev/null; then
    info "Installing git..."
    case "$PKG_MANAGER" in
        apt)    pkg_install git ;;
        dnf|yum) pkg_install git ;;
        pacman) pkg_install git ;;
        zypper) pkg_install git ;;
        apk)    pkg_install git ;;
        *) fail "Install git manually then re-run."; exit 1 ;;
    esac
fi
ok "$(git --version)"

# ── 2. Node.js >= 20 ─────────────────────────────────────────────────────────
step "2/6" "Checking Node.js (need >= 20)..."
need_node=true
if command -v node &>/dev/null; then
    node_ver=$(node --version | tr -d 'v')
    node_major=$(echo "$node_ver" | cut -d. -f1)
    if [[ "$node_major" -ge 20 ]]; then
        need_node=false
        ok "Node.js v$node_ver"
    else
        info "Node.js v$node_ver is too old — upgrading..."
    fi
fi

if $need_node; then
    info "Installing Node.js 20 LTS..."
    case "$PKG_MANAGER" in
        apt)
            # NodeSource setup for Debian/Ubuntu
            if ! command -v curl &>/dev/null; then pkg_install curl; fi
            curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - >/dev/null 2>&1
            pkg_install nodejs
            ;;
        dnf|yum)
            curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo -E bash - >/dev/null 2>&1
            pkg_install nodejs
            ;;
        pacman)
            pkg_install nodejs npm
            ;;
        zypper)
            pkg_install nodejs20 npm20 2>/dev/null || pkg_install nodejs npm
            ;;
        apk)
            pkg_install nodejs npm
            ;;
        *)
            fail "Cannot auto-install Node.js."
            fail "Install Node.js 20 LTS from https://nodejs.org and re-run."
            exit 1
            ;;
    esac
    ok "Node.js $(node --version)"
fi

# ── 3. Clone / update ────────────────────────────────────────────────────────
step "3/6" "Installing to $INSTALL_DIR ..."
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

# ── 4. npm install ───────────────────────────────────────────────────────────
step "4/6" "Installing dependencies (takes ~1 min first time)..."
cd "$INSTALL_DIR"
npm install --prefer-offline 2>&1 | tail -3
ok "Dependencies installed"

# ── 5. tshark (optional) ─────────────────────────────────────────────────────
step "5/6" "Setting up packet capture (optional)..."
if command -v tshark &>/dev/null; then
    ok "tshark already installed"
else
    echo ""
    echo -e "${Y}  ┌─ Packet Capture Setup (optional) ──────────────────────┐${W}"
    echo -e "${Y}  │  Install tshark then add yourself to the wireshark group: │${W}"
    echo ""
    case "$PKG_MANAGER" in
        apt)
            echo -e "${C}    sudo apt install -y tshark${W}"
            echo -e "${C}    sudo usermod -aG wireshark \$USER${W}"
            echo -e "${C}    newgrp wireshark  # or log out and back in${W}"
            ;;
        dnf|yum)
            echo -e "${C}    sudo dnf install -y wireshark-cli${W}"
            echo -e "${C}    sudo usermod -aG wireshark \$USER${W}"
            ;;
        pacman)
            echo -e "${C}    sudo pacman -S wireshark-cli${W}"
            echo -e "${C}    sudo usermod -aG wireshark \$USER${W}"
            ;;
        *)
            echo -e "${C}    Install wireshark/tshark from your package manager${W}"
            ;;
    esac
    echo ""
    echo -e "${Y}  │  The app works without it — use On-device Capture to    │${W}"
    echo -e "${Y}  │  run the switch's built-in sniffer instead.              │${W}"
    echo -e "${Y}  └──────────────────────────────────────────────────────────┘${W}"
    echo ""
fi

# ── 6. Create launcher + .desktop entry ──────────────────────────────────────
step "6/6" "Creating launcher + application menu entry..."
mkdir -p "$BIN_DIR" "$DESKTOP_DIR"

cat > "$BIN_LINK" <<LAUNCHEOF
#!/usr/bin/env bash
cd "$INSTALL_DIR"
exec npm start
LAUNCHEOF
chmod +x "$BIN_LINK"

# Ensure ~/.local/bin is in PATH (add to .bashrc / .zshrc if missing)
for rc_file in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile"; do
    if [[ -f "$rc_file" ]] && ! grep -q '/.local/bin' "$rc_file" 2>/dev/null; then
        echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$rc_file"
        info "Added ~/.local/bin to PATH in $rc_file"
    fi
done
export PATH="$BIN_DIR:$PATH"

cat > "$DESKTOP_FILE" <<DESKEOF
[Desktop Entry]
Version=1.0
Type=Application
Name=$APP_NAME
Comment=AI-guided network configuration copilot for engineers
Exec=$BIN_LINK
Terminal=false
Categories=Network;System;
StartupNotify=true
DESKEOF
update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true
ok "Launcher at: ahuva"
ok "App menu entry created"

# ── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo -e "${G}  ╔══════════════════════════════════════════════════╗${W}"
echo -e "${G}  ║   Installation complete!                         ║${W}"
echo -e "${G}  ╚══════════════════════════════════════════════════╝${W}"
echo ""
echo -e "  Launch options:"
echo -e "${C}    • Application menu → $APP_NAME${W}"
echo -e "${C}    • Terminal:  ahuva${W}  (may need new shell for PATH to take effect)"
echo -e "${C}    • Or:  cd \"$INSTALL_DIR\" && npm start${W}"
echo ""
echo -e "  To update later, re-run this script."
echo ""

read -rp "  Launch now? [Y/n] " launch
if [[ "${launch:-Y}" != "n" && "${launch:-Y}" != "N" ]]; then
    "$BIN_LINK" &
    echo -e "${G}  Launching...${W}"
fi
echo ""
