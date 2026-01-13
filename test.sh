#!/bin/bash

# OpenTunnel Test Script
# ======================
# This script tests the tunnel system locally

set -e

echo "========================================"
echo "  OpenTunnel Local Test"
echo "========================================"
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Cleanup function
cleanup() {
    echo ""
    echo -e "${YELLOW}Cleaning up...${NC}"

    # Stop test server
    if [ -f ".test-server-3000.pid" ]; then
        kill $(cat .test-server-3000.pid) 2>/dev/null || true
        rm -f .test-server-3000.pid
    fi

    # Stop tunnel server
    if [ -f ".opentunnel.pid" ]; then
        kill $(cat .opentunnel.pid) 2>/dev/null || true
        rm -f .opentunnel.pid
    fi

    # Stop tunnel client
    if [ -f ".opentunnel-3000.pid" ]; then
        kill $(cat .opentunnel-3000.pid) 2>/dev/null || true
        rm -f .opentunnel-3000.pid
    fi

    echo -e "${GREEN}Cleanup complete${NC}"
}

# Set trap for cleanup on exit
trap cleanup EXIT

# Build first
echo -e "${CYAN}1. Building project...${NC}"
npm run build
echo ""

# Start test HTTP server on port 3000
echo -e "${CYAN}2. Starting test HTTP server on port 3000...${NC}"
node dist/cli/index.js test-server -p 3000 -d
sleep 1
echo ""

# Start tunnel server (no HTTPS for local testing)
echo -e "${CYAN}3. Starting tunnel server on port 8080...${NC}"
node dist/cli/index.js server --domain localhost -d
sleep 2
echo ""

# Create tunnel
echo -e "${CYAN}4. Creating HTTP tunnel...${NC}"
node dist/cli/index.js http 3000 -n test -d
sleep 2
echo ""

# Show status
echo -e "${CYAN}5. Checking status...${NC}"
node dist/cli/index.js ps
echo ""

# Test the tunnel
echo -e "${CYAN}6. Testing tunnel...${NC}"
echo ""
echo -e "${YELLOW}Testing direct connection to test server:${NC}"
curl -s http://localhost:3000 | head -20
echo ""
echo ""
echo -e "${YELLOW}Testing tunnel connection (via subdomain):${NC}"
echo -e "${CYAN}Note: For local testing, add to /etc/hosts:${NC}"
echo -e "${CYAN}  127.0.0.1 test.op.localhost${NC}"
echo ""

# Try tunnel request
curl -s -H "Host: test.op.localhost" http://localhost:8080 | head -20 || echo "Tunnel test requires hosts file entry"

echo ""
echo "========================================"
echo -e "${GREEN}  Test Complete!${NC}"
echo "========================================"
echo ""
echo "URLs:"
echo "  - Test server:  http://localhost:3000"
echo "  - Tunnel server: http://localhost:8080"
echo "  - Tunnel URL:   http://test.op.localhost:8080"
echo ""
echo "Commands:"
echo "  - View logs:    tail -f opentunnel.log"
echo "  - View status:  node dist/cli/index.js ps"
echo "  - Stop all:     node dist/cli/index.js down"
echo ""
echo "Press Ctrl+C to stop and cleanup..."

# Keep running until interrupted
while true; do
    sleep 1
done
