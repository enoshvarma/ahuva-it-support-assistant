#!/usr/bin/env bash
# Ahuva IT Support Assistant — macOS Installer
# Usage:  bash install-mac.sh
# Requires macOS 12 Monterey or later, Intel or Apple Silicon

set -euo pipefail

APP_NAME="Ahuva IT Support Assistant"
REPO_URL="https://github.com/enoshvarma/ahuva-it-support-assistant.git"
INSTALL_DIR="$HOME/Applications/AhuvaITAssistant"
ALIAS_DIR="$HOME/Desktop"

CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'

echo ""
echo -e "${CYAN}  ╔══════════════════════════════════════════╗${NC}"
echo -e "${CYAN}  ║   Ahuva IT Support Assistant Installer   ║${NC}"
echo -e "${CYAN}  ║              macOS                        ║${NC}"
echo -e "${CYAN}  ╚══════════════════════════════════════════╝${NC}"
echo ""

# ── 1. Prerequisites ────────────────────────────────────────────
echo -e "${YELLOW}[1/5] Checking prerequisites...${NC}"

# Homebrew
if ! command -v brew &>/dev/null; then
    echo -e "  → Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi
echo -e "${GREEN}  ✓  brew $(brew --version | head -1)${NC}"

# git (comes with Xcode CLT; brew install just in case)
if ! command -v git &>/dev/null; then
    brew install git
fi
echo -e "${GREEN}  ✓  git $(git --version)${NC}"

# Node.js
if ! command -v node &>/dev/null; then
    echo -e "  → Installing Node.js via Homebrew..."
    brew install node@20
    brew link node@20 --force --overwrite
fi
NODE_VER=$(node --version)
echo -e "${GREEN}  ✓  Node.js $NODE_VER${NC}"

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
    echo -e "  → Installing tshark via Homebrew..."
    brew install wireshark 2>/dev/null && \
        sudo chmod o+r /dev/bpf* 2>/dev/null && \
        echo -e "${GREEN}  ✓  tshark installed + BPF permissions set${NC}" || \
        echo -e "  ⚠  Install Wireshark manually from https://www.wireshark.org for packet capture"
fi

# ── 5. Desktop launcher (shell script + alias) ──────────────────
echo -e "${YELLOW}[5/5] Creating desktop launcher...${NC}"

LAUNCHER="$INSTALL_DIR/Launch Ahuva.command"
cat > "$LAUNCHER" <<EOF
#!/usr/bin/env bash
cd "$INSTALL_DIR"
npm start
EOF
chmod +x "$LAUNCHER"

# Desktop alias (symlink)
DESKTOP_ALIAS="$ALIAS_DIR/Ahuva IT Support Assistant.command"
[ -L "$DESKTOP_ALIAS" ] && rm "$DESKTOP_ALIAS"
ln -s "$LAUNCHER" "$DESKTOP_ALIAS"

echo -e "${GREEN}  ✓  Desktop launcher created: $DESKTOP_ALIAS${NC}"

echo ""
echo -e "${GREEN}  Done!${NC}"
echo ""
echo -e "  Double-click  'Ahuva IT Support Assistant.command'  on your Desktop, or run:"
echo -e "${CYAN}    cd \"$INSTALL_DIR\" && npm start${NC}"
echo ""
echo -e "  macOS tip: if macOS blocks the launcher, right-click → Open → Open"
echo ""

read -rp "Launch now? [Y/n] " launch
if [[ "$launch" != "n" && "$launch" != "N" ]]; then
    open "$LAUNCHER"
fi
