#!/usr/bin/env bash
# Ahuva IT Support Assistant — Linux Installer
# Usage:  bash install-linux.sh
# Tested on Ubuntu 22.04 / Debian 12 / RHEL 9

set -euo pipefail

APP_NAME="Ahuva IT Support Assistant"
REPO_URL="https://github.com/enoshvarma/ahuva-it-support-assistant.git"
INSTALL_DIR="$HOME/.local/share/ahuva-it-assistant"
BIN_LINK="$HOME/.local/bin/ahuva"
DESKTOP_FILE="$HOME/.local/share/applications/ahuva-it-assistant.desktop"

CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'

echo ""
echo -e "${CYAN}  ╔══════════════════════════════════════════╗${NC}"
echo -e "${CYAN}  ║   Ahuva IT Support Assistant Installer   ║${NC}"
echo -e "${CYAN}  ╚══════════════════════════════════════════╝${NC}"
echo ""

# ── 1. Check prerequisites ──────────────────────────────────────
echo -e "${YELLOW}[1/5] Checking prerequisites...${NC}"

check_cmd() {
    if ! command -v "$1" &>/dev/null; then
        echo -e "${RED}  ✗  $1 not found.${NC}"
        echo -e "     $2"
        exit 1
    fi
    echo -e "${GREEN}  ✓  $1 $(command "$1" --version 2>&1 | head -1)${NC}"
}

check_cmd git "Install: sudo apt install git   OR   sudo dnf install git"
check_cmd node "Install Node.js 20+ from https://nodejs.org or: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash - && sudo apt install -y nodejs"
check_cmd npm "npm should come with Node.js"

# ── 2. Clone / update ───────────────────────────────────────────
echo -e "${YELLOW}[2/5] Installing to $INSTALL_DIR ...${NC}"
mkdir -p "$(dirname "$INSTALL_DIR")"
if [ -d "$INSTALL_DIR/.git" ]; then
    echo -e "  → Updating existing install..."
    git -C "$INSTALL_DIR" pull --ff-only
else
    [ -d "$INSTALL_DIR" ] && rm -rf "$INSTALL_DIR"
    git clone "$REPO_URL" "$INSTALL_DIR"
fi
echo -e "${GREEN}  ✓  Source ready${NC}"

# ── 3. npm install ──────────────────────────────────────────────
echo -e "${YELLOW}[3/5] Installing dependencies (takes ~1 min)...${NC}"
cd "$INSTALL_DIR"
npm install --prefer-offline 2>&1 | tail -3
echo -e "${GREEN}  ✓  Dependencies installed${NC}"

# ── 4. Wireshark / tshark for packet capture ────────────────────
echo -e "${YELLOW}[4/5] Setting up packet capture (optional)...${NC}"
if command -v tshark &>/dev/null; then
    echo -e "${GREEN}  ✓  tshark already installed${NC}"
else
    echo -e "  → Installing tshark..."
    if command -v apt &>/dev/null; then
        sudo DEBIAN_FRONTEND=noninteractive apt install -y tshark 2>/dev/null && \
            sudo usermod -aG wireshark "$USER" && \
            echo -e "${GREEN}  ✓  tshark installed (log out & back in to activate capture)${NC}" || \
            echo -e "  ⚠  Could not install tshark — packet capture won't work"
    elif command -v dnf &>/dev/null; then
        sudo dnf install -y wireshark-cli 2>/dev/null && \
            sudo usermod -aG wireshark "$USER" && \
            echo -e "${GREEN}  ✓  tshark installed${NC}" || \
            echo -e "  ⚠  Could not install tshark"
    else
        echo -e "  ⚠  Install tshark manually for packet capture"
    fi
fi

# ── 5. Create launcher & .desktop entry ─────────────────────────
echo -e "${YELLOW}[5/5] Creating launcher...${NC}"
mkdir -p "$HOME/.local/bin" "$(dirname "$DESKTOP_FILE")"

# shell launcher
cat > "$BIN_LINK" <<EOF
#!/usr/bin/env bash
cd "$INSTALL_DIR"
exec npm start
EOF
chmod +x "$BIN_LINK"

# .desktop file for GNOME/KDE/XFCE application menu
cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=$APP_NAME
Comment=AI-guided network configuration copilot
Exec=$BIN_LINK
Terminal=false
Categories=Network;System;
StartupNotify=true
EOF
update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
echo -e "${GREEN}  ✓  Launcher + application menu entry created${NC}"

echo ""
echo -e "${GREEN}  Done! ${NC}"
echo ""
echo -e "  Launch from the application menu, or run:"
echo -e "${CYAN}    ahuva${NC}"
echo ""
echo -e "  To update later, re-run this script."
echo ""

read -rp "Launch now? [Y/n] " launch
if [[ "$launch" != "n" && "$launch" != "N" ]]; then
    "$BIN_LINK" &
fi
