<h1 align="center">OpenTunnel</h1>

<p align="center">Self-hosted alternative to ngrok. Expose local services to the internet with custom subdomains.</p>

---

## Table of Contents

- [As a Client](#-as-a-client) - Expose your local ports
- [As a Server](#-as-a-server) - Host your own tunnel server
- [Authentication](#-authentication) - Secure your server
- [Configuration File](#-configuration-file) - opentunnel.yml reference
- [Commands Reference](#-commands-reference)

---

# 📱 As a Client

Use OpenTunnel to expose your local services to the internet. Connect to any OpenTunnel server (your own or one shared with you).

## Installation

```bash
# NPM (recommended)
npm install -g opentunnel-cli

# Or use without installing
npx opentunnel-cli quick 3000 -s wss://op.example.com/_tunnel
```

## Quick Start

### Option 1: Quick Command

The fastest way to expose a port:

```bash
opentunnel quick 3000 -s wss://op.example.com/_tunnel
```

Your local port 3000 is now accessible from the internet:

```
  Status:    ● Online
  Local:     localhost:3000
  Public:    https://myapp.op.example.com
```

**Options:**
```bash
opentunnel quick 3000 -s wss://op.example.com/_tunnel                # Basic HTTP tunnel
opentunnel quick 3000 -s wss://op.example.com/_tunnel -n myapp       # Custom subdomain
opentunnel quick 5432 -s wss://op.example.com/_tunnel -p tcp         # TCP tunnel
opentunnel quick 3000 -s wss://op.example.com/_tunnel -t SECRET      # With auth token
opentunnel quick 3000 -s wss://op.example.com/_tunnel --insecure     # Self-signed cert
```

### Option 2: HTTP/TCP Commands

More control with specific commands:

```bash
# HTTP tunnel
opentunnel http 3000 --server wss://op.example.com/_tunnel

# With authentication
opentunnel http 3000 --server wss://op.example.com/_tunnel --token SECRET

# TCP tunnel
opentunnel tcp 5432 --server wss://op.example.com/_tunnel --remote-port 15432
```

### Option 3: Using Config File

Create `opentunnel.yml`:

```yaml
version: "1.0"

server:
  remote: op.example.com    # Server to connect to
  token: your-secret-token      # Optional: authentication token

tunnels:
  - name: web
    protocol: http
    port: 3000
    subdomain: myapp

  - name: api
    protocol: http
    port: 4000
    subdomain: api

  - name: postgres
    protocol: tcp
    port: 5432
    remotePort: 15432
```

```bash
opentunnel up      # Start all tunnels
opentunnel down    # Stop all tunnels
opentunnel ps      # Check status
```

---

# 🖥️ As a Server

Host your own OpenTunnel server to have full control. Your server can be **public** (anyone can connect) or **private** (requires authentication).

## Requirements

- **VPS or server** with a public IP address
- **Domain** pointing to your server
- **Ports** 443 (HTTPS) and optionally 10000-20000 (TCP tunnels)

## DNS Configuration

Create these DNS records pointing to your server:

| Type | Name | Value | Notes |
|------|------|-------|-------|
| A | `op` | `YOUR_SERVER_IP` | Main server |
| A | `*.op` | `YOUR_SERVER_IP` | Wildcard for subdomains |

> **Cloudflare users:** Set proxy status to "DNS only" (gray cloud)

Example for domain `example.com`:
- `op.example.com` → Your server IP
- `*.op.example.com` → Your server IP (wildcard)

Tunnels will be available at: `https://myapp.op.example.com`

## Deployment Options

### Option 1: Quick Start (Manual)

```bash
# Install
npm install -g opentunnel-cli

# Start public server (anyone can connect)
sudo opentunnel server --domain example.com --letsencrypt --email admin@example.com

# Start private server (requires token to connect)
sudo opentunnel server --domain example.com --letsencrypt --email admin@example.com --auth-tokens "SECRET123"

# OR

sudo opentunnel server --domain example.com --letsencrypt --email admin@example.com --auth-tokens "SECRET1,SECRET2"
```

### Option 2: Docker (Recommended for Production)

```bash
git clone https://github.com/FJRG2007/opentunnel.git
cd opentunnel

# Configure
cp .env.example .env
nano .env
```

Edit `.env`:
```env
DOMAIN=op.example.com
AUTH_TOKENS=SECRET123           # Leave empty for public server
LETSENCRYPT_EMAIL=admin@example.com
LETSENCRYPT_PRODUCTION=true
```

```bash
docker-compose up -d
```

### Option 3: One-Line Install (Linux with systemd)

```bash
curl -fsSL https://raw.githubusercontent.com/FJRG2007/opentunnel/main/deploy/install.sh | sudo bash
```

Then configure:
```bash
sudo nano /opt/opentunnel/.env
sudo systemctl start opentunnel
sudo systemctl status opentunnel
```

## Server Options

```bash
opentunnel server [options]

Required:
  --domain <domain>           Your domain (e.g., op.example.com)

Optional:
  -p, --port <port>           Server port (default: 443)
  -b, --base-path <path>      Subdomain prefix (default: none)
  --tcp-min <port>            Min TCP tunnel port (default: 10000)
  --tcp-max <port>            Max TCP tunnel port (default: 20000)

Authentication:
  --auth-tokens <tokens>      Comma-separated tokens for private server
                              Leave empty for public server

SSL/TLS:
  --letsencrypt               Enable Let's Encrypt certificates
  --email <email>             Email for Let's Encrypt
  --production                Use Let's Encrypt production (not staging)
  --cloudflare-token <token>  Cloudflare API token for DNS-01 challenge

Other:
  -d, --detach                Run in background
```

## Server Modes

### Public Server

Anyone can connect without authentication:

```bash
opentunnel server --domain op.example.com --letsencrypt --email admin@example.com
```

Clients connect with:
```bash
opentunnel quick 3000 --server wss://op.example.com/_tunnel
```

### Private Server

Only clients with valid tokens can connect:

```bash
opentunnel server --domain op.example.com --letsencrypt --email admin@example.com --auth-tokens "token1,token2,token3"
```

Clients must provide a token:
```bash
opentunnel quick 3000 --server wss://op.example.com/_tunnel --token token1
```

---

# 🔐 Authentication

OpenTunnel uses a **shared secret** system for authentication. The server defines a list of valid tokens, and clients must provide one to connect.

## Server Setup

```bash
# Single token
opentunnel server --domain example.com --auth-tokens "my-secret-token"

# Multiple tokens (one per user/team)
opentunnel server --domain example.com --auth-tokens "team-a-token,team-b-token,dev-token"
```

Or in `.env`:
```env
AUTH_TOKENS=team-a-token,team-b-token,dev-token
```

## Client Usage

```bash
# Command line
opentunnel quick 3000 --token my-secret-token

# Or in opentunnel.yml
server:
  remote: op.example.com
  token: my-secret-token
```

## Security Recommendations

1. **Use strong tokens**: Generate random strings (e.g., `openssl rand -hex 32`)
2. **One token per user/team**: Easier to revoke access if needed
3. **HTTPS only**: Always use `--letsencrypt` in production
4. **Rotate tokens periodically**: Update tokens and notify users

---

# 📄 Configuration File

Create `opentunnel.yml` in your project directory:

## Client Mode (connect to remote server)

```yaml
version: "1.0"

server:
  remote: op.example.com      # Server hostname
  token: your-secret-token        # Optional: for private servers

tunnels:
  - name: frontend
    protocol: http
    port: 3000
    subdomain: app                 # → app.op.example.com
    autostart: true

  - name: backend
    protocol: http
    port: 4000
    subdomain: api                 # → api.op.example.com

  - name: database
    protocol: tcp
    port: 5432
    remotePort: 15432              # → op.example.com:15432
    autostart: false               # Start manually with: opentunnel tunnel database
```

## Server Mode (run your own server)

```yaml
version: "1.0"

server:
  domain: op.example.com
  port: 443
  https: true
  tcpPortMin: 10000
  tcpPortMax: 20000
  # token: optional-auth-token    # Uncomment for private server

tunnels: []  # Server-only, no local tunnels
```

## Commands

```bash
opentunnel init       # Create example config file
opentunnel up         # Start server/tunnels from config
opentunnel up -d      # Start in background
opentunnel down       # Stop everything
opentunnel ps         # Show running processes
```

---

# 📖 Commands Reference

| Command | Description |
|---------|-------------|
| `opentunnel quick <port> -s <server>` | Quick tunnel to a server |
| `opentunnel http <port>` | HTTP tunnel with options |
| `opentunnel tcp <port>` | TCP tunnel with options |
| `opentunnel server` | Start tunnel server |
| `opentunnel up` | Start from opentunnel.yml |
| `opentunnel down` | Stop all tunnels |
| `opentunnel ps` | List running processes |
| `opentunnel init` | Create config file |
| `opentunnel setup` | Show setup guide |
| `opentunnel logs` | View server logs |
| `opentunnel status` | Check server status |

## Quick Command

```bash
opentunnel quick <port> -s <server-url> [options]

Required:
  -s, --server <url>        Server URL (e.g., wss://op.example.com/_tunnel)

Options:
  -n, --subdomain <name>    Request specific subdomain
  -p, --protocol <proto>    http, https, or tcp (default: http)
  -h, --host <host>         Local host (default: localhost)
  -t, --token <token>       Authentication token
  --insecure                Skip SSL verification (self-signed certs)
```

## HTTP/TCP Commands

```bash
opentunnel http <port> [options]
opentunnel tcp <port> [options]

Options:
  -s, --server <url>        Server WebSocket URL
  -t, --token <token>       Authentication token
  -n, --subdomain <name>    Custom subdomain
  -h, --host <host>         Local host (default: localhost)
  -r, --remote-port <port>  Remote TCP port (tcp only)
  -d, --detach              Run in background
```

---

# 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         INTERNET                                 │
│                                                                  │
│   Users access: https://myapp.op.example.com                │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                    OpenTunnel Server                             │
│                  (op.example.com)                           │
│                                                                  │
│   - Receives HTTPS requests                                     │
│   - Routes by subdomain                                         │
│   - Forwards to connected clients via WebSocket                 │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               │ WebSocket (persistent connection)
                               │
┌──────────────────────────────┴──────────────────────────────────┐
│                      Your Computer                               │
│                  (behind NAT/firewall)                          │
│                                                                  │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│   │  Web App     │  │  API Server  │  │  Database    │         │
│   │  :3000       │  │  :4000       │  │  :5432       │         │
│   └──────────────┘  └──────────────┘  └──────────────┘         │
│                                                                  │
│   opentunnel up  ← Connects to server, no port forwarding      │
└─────────────────────────────────────────────────────────────────┘
```

**Key points:**
- Client initiates connection (outbound only)
- No port forwarding needed on client's router
- All traffic goes through the server
- WebSocket keeps connection alive

---

# 📜 License

[Proprietary License](LICENSE) - All rights reserved.

- ✅ Personal and educational use allowed
- ❌ No forks or redistribution without permission
- ❌ No commercial use without explicit consent

Contact FJRG2007 for commercial licensing.
