#!/bin/bash
# OpenTunnel Server Installation Script
# Usage: curl -fsSL https://raw.githubusercontent.com/FJRG2007/opentunnel/main/deploy/install.sh | bash

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}"
echo " ██████╗ ██████╗ ███████╗███╗   ██╗████████╗██╗   ██╗███╗   ██╗███╗   ██╗███████╗██╗"
echo "██╔═══██╗██╔══██╗██╔════╝████╗  ██║╚══██╔══╝██║   ██║████╗  ██║████╗  ██║██╔════╝██║"
echo "██║   ██║██████╔╝█████╗  ██╔██╗ ██║   ██║   ██║   ██║██╔██╗ ██║██╔██╗ ██║█████╗  ██║"
echo "██║   ██║██╔═══╝ ██╔══╝  ██║╚██╗██║   ██║   ██║   ██║██║╚██╗██║██║╚██╗██║██╔══╝  ██║"
echo "╚██████╔╝██║     ███████╗██║ ╚████║   ██║   ╚██████╔╝██║ ╚████║██║ ╚████║███████╗███████╗"
echo " ╚═════╝ ╚═╝     ╚══════╝╚═╝  ╚═══╝   ╚═╝    ╚═════╝ ╚═╝  ╚═══╝╚═╝  ╚═══╝╚══════╝╚══════╝"
echo -e "${NC}"
echo -e "${GREEN}OpenTunnel Server Installation${NC}"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}Error: Please run as root (sudo)${NC}"
    exit 1
fi

# Check for required commands
command -v node >/dev/null 2>&1 || {
    echo -e "${YELLOW}Node.js not found. Installing...${NC}"
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
}

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo -e "${RED}Error: Node.js 18+ required. Current: $(node -v)${NC}"
    exit 1
fi

echo -e "${GREEN}✓${NC} Node.js $(node -v) detected"

# Create opentunnel user
if ! id "opentunnel" &>/dev/null; then
    echo -e "${CYAN}Creating opentunnel user...${NC}"
    useradd --system --no-create-home --shell /bin/false opentunnel
    echo -e "${GREEN}✓${NC} User created"
fi

# Create installation directory
INSTALL_DIR="/opt/opentunnel"
echo -e "${CYAN}Installing to ${INSTALL_DIR}...${NC}"

if [ -d "$INSTALL_DIR" ]; then
    echo -e "${YELLOW}Existing installation found. Backing up...${NC}"
    mv "$INSTALL_DIR" "${INSTALL_DIR}.backup.$(date +%Y%m%d%H%M%S)"
fi

mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# Clone repository
echo -e "${CYAN}Downloading OpenTunnel...${NC}"
git clone --depth 1 https://github.com/FJRG2007/opentunnel.git .

# Install dependencies
echo -e "${CYAN}Installing dependencies...${NC}"
npm ci --only=production

# Build
echo -e "${CYAN}Building...${NC}"
npm run build

# Create directories
mkdir -p "$INSTALL_DIR/.certs"
mkdir -p "$INSTALL_DIR/logs"

# Set permissions
chown -R opentunnel:opentunnel "$INSTALL_DIR"

# Create default .env if not exists
if [ ! -f "$INSTALL_DIR/.env" ]; then
    echo -e "${CYAN}Creating default configuration...${NC}"
    cat > "$INSTALL_DIR/.env" << 'EOF'
# OpenTunnel Configuration
# Edit this file with your settings

# REQUIRED: Your domain
DOMAIN=tunnel.yourdomain.com

# Optional settings
BASE_PATH=op
PORT=443
HOST=0.0.0.0
TCP_PORT_MIN=10000
TCP_PORT_MAX=20000

# Authentication (optional, comma-separated tokens)
AUTH_TOKENS=

# Let's Encrypt (optional)
LETSENCRYPT_EMAIL=
LETSENCRYPT_PRODUCTION=false

# Cloudflare (optional, for DNS-01 challenge)
CLOUDFLARE_TOKEN=
EOF
    echo -e "${YELLOW}! Edit /opt/opentunnel/.env with your domain${NC}"
fi

# Install systemd service
echo -e "${CYAN}Installing systemd service...${NC}"
cp "$INSTALL_DIR/deploy/opentunnel.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable opentunnel

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  OpenTunnel installed successfully!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${CYAN}Next steps:${NC}"
echo ""
echo -e "  1. Edit configuration:"
echo -e "     ${YELLOW}sudo nano /opt/opentunnel/.env${NC}"
echo ""
echo -e "  2. Configure your DNS:"
echo -e "     Add A records for your domain pointing to this server's IP"
echo -e "     ${CYAN}*.op.yourdomain.com${NC} -> ${CYAN}<SERVER_IP>${NC}"
echo -e "     ${CYAN}op.yourdomain.com${NC}   -> ${CYAN}<SERVER_IP>${NC}"
echo ""
echo -e "  3. Start the server:"
echo -e "     ${YELLOW}sudo systemctl start opentunnel${NC}"
echo ""
echo -e "  4. Check status:"
echo -e "     ${YELLOW}sudo systemctl status opentunnel${NC}"
echo ""
echo -e "  5. View logs:"
echo -e "     ${YELLOW}sudo journalctl -u opentunnel -f${NC}"
echo ""
echo -e "  ${CYAN}Clients can now connect with:${NC}"
echo -e "     ${GREEN}opentunnel quick 3000${NC}"
echo -e "     ${GREEN}opentunnel http 3000 --server wss://op.yourdomain.com/_tunnel${NC}"
echo ""
