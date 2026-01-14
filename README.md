<h1 align="center">OpenTunnel</h1>

<p align="center">Self-hosted alternative to ngrok. Expose local services to the internet with custom subdomains.</p>

---

## Table of Contents

- [As a Client](#-as-a-client) - Expose your local ports
- [As a Server](#-as-a-server) - Host your own tunnel server
- [Authentication](#-authentication) - Secure your server
- [IP Access Control](#-ip-access-control) - Allow/deny IPs and CIDR ranges
- [Configuration File](#-configuration-file) - opentunnel.yml reference
  - [Environment Variables](#environment-variables) - Docker-style ${VAR:-default} syntax
- [Commands Reference](#-commands-reference)

---

# 📱 As a Client

Use OpenTunnel to expose your local services to the internet. Connect to any OpenTunnel server (your own or one shared with you).

## Installation

```bash
# NPM (recommended)
npm install -g opentunnel-cli

# Or use without installing
npx opentunnel-cli quick 3000 -s example.com
```

## Quick Start

### Option 1: Quick Command

The fastest way to expose a port:

```bash
opentunnel quick 3000 -s example.com
```

Your local port 3000 is now accessible from the internet:

```
  Status:    ● Online
  Local:     localhost:3000
  Public:    https://myapp.op.example.com
```

**Options:**
```bash
opentunnel quick 3000 -s example.com                  # Basic HTTP tunnel
opentunnel quick 3000 -s example.com -n myapp         # Custom subdomain
opentunnel quick 5432 -s example.com -p tcp           # TCP tunnel
opentunnel quick 3000 -s example.com -t SECRET        # With auth token
opentunnel quick 3000 -s example.com --insecure       # Self-signed cert
opentunnel quick 3000 -s example.com -b ""            # No basePath (direct domain)
```

### Option 2: HTTP/TCP Commands

More control with specific commands:

```bash
# HTTP tunnel
opentunnel http 3000 -s example.com

# With authentication
opentunnel http 3000 -s example.com -t SECRET

# TCP tunnel
opentunnel tcp 5432 -s example.com -r 15432
```

### Option 3: Using Config File

Create `opentunnel.yml`:

```yaml
server:
  remote: example.com             # Base domain (system adds basePath)
  token: ${AUTH_TOKEN}            # From .env file (optional)

tunnels:
  - name: web
    protocol: http
    port: 3000
    subdomain: myapp              # → myapp.op.example.com

  - name: api
    protocol: http
    port: 4000
    subdomain: api                # → api.op.example.com

  - name: postgres
    protocol: tcp
    port: 5432
    remotePort: 15432             # → example.com:15432
```

```bash
opentunnel up         # Start all tunnels
opentunnel up -d      # Start in background
opentunnel down       # Stop all tunnels
opentunnel ps         # Check status
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
| A | `op` | `YOUR_SERVER_IP` | Main server (or your basePath) |
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
opentunnel server -d --domain example.com --letsencrypt --email admin@example.com

# Start private server (requires token to connect)
opentunnel server -d --domain example.com --letsencrypt --email admin@example.com --auth-tokens "SECRET123"

# Stop server
opentunnel stop
```

### Option 2: Using Config File

Create `opentunnel.yml`:

```yaml
server:
  domain: example.com             # Base domain only
  # token: SECRET123              # Uncomment for private server
  # tcpPortMin: 10000             # TCP tunnel port range (optional)
  # tcpPortMax: 20000
```

```bash
opentunnel server -d    # Start in background (reads from opentunnel.yml)
opentunnel stop         # Stop server
```

### Option 3: Docker (Recommended for Production)

```bash
git clone https://github.com/FJRG2007/opentunnel.git
cd opentunnel

# Configure
cp .env.example .env
nano .env
```

Edit `.env`:
```env
DOMAIN=example.com              # Base domain only (without the op prefix)
AUTH_TOKENS=SECRET123           # Leave empty for public server
LETSENCRYPT_EMAIL=admin@example.com
LETSENCRYPT_PRODUCTION=true
```

```bash
docker-compose up -d
docker-compose down     # Stop server
```

### Option 4: One-Line Install (Linux with systemd)

```bash
curl -fsSL https://raw.githubusercontent.com/FJRG2007/opentunnel/main/deploy/install.sh | sudo bash
```

Then configure:
```bash
sudo nano /opt/opentunnel/.env
sudo systemctl start opentunnel
sudo systemctl stop opentunnel
sudo systemctl status opentunnel
```

## Server Options

```bash
opentunnel server [options]

Required:
  --domain <domain>           Your base domain (e.g., example.com)
                              Tunnels will be at: *.op.example.com

Optional:
  -p, --port <port>           Server port (default: 443)
  -b, --base-path <path>      Subdomain prefix (default: op, empty for direct)
  --tcp-min <port>            Min TCP tunnel port (default: 10000)
  --tcp-max <port>            Max TCP tunnel port (default: 20000)
  -d, --detach                Run in background

Authentication:
  --auth-tokens <tokens>      Comma-separated tokens for private server
                              Leave empty for public server

SSL/TLS:
  --letsencrypt               Enable Let's Encrypt certificates
  --email <email>             Email for Let's Encrypt
  --production                Use Let's Encrypt production (not staging)
  --cloudflare-token <token>  Cloudflare API token for DNS-01 challenge

IP Access Control:
  --ip-mode <mode>            Access mode: all, allowlist, denylist (default: all)
  --ip-allow <ips>            Comma-separated IPs/CIDRs to allow
  --ip-deny <ips>             Comma-separated IPs/CIDRs to deny
```

## Server Modes

### Public Server

Anyone can connect without authentication:

```bash
opentunnel server -d --domain example.com --letsencrypt --email admin@example.com
```

Clients connect with:
```bash
opentunnel quick 3000 -s example.com
```

### Private Server

Only clients with valid tokens can connect:

```bash
opentunnel server -d --domain example.com --letsencrypt --email admin@example.com --auth-tokens "token1,token2"
```

Clients must provide a token:
```bash
opentunnel quick 3000 -s example.com -t token1
```

---

# 🔐 Authentication

OpenTunnel uses a **shared secret** system for authentication. The server defines a list of valid tokens, and clients must provide one to connect.

## Server Setup

```bash
# Single token
opentunnel server -d --domain example.com --auth-tokens "my-secret-token"

# Multiple tokens (one per user/team)
opentunnel server -d --domain example.com --auth-tokens "team-a-token,team-b-token,dev-token"
```

Or in `opentunnel.yml`:
```yaml
server:
  domain: example.com
  token: my-secret-token
```

Or in `.env`:
```env
AUTH_TOKENS=team-a-token,team-b-token,dev-token
```

## Client Usage

```bash
# Command line
opentunnel quick 3000 -s example.com -t my-secret-token

# Or in opentunnel.yml
server:
  remote: example.com
  token: my-secret-token
```

## Security Recommendations

1. **Use strong tokens**: Generate random strings (e.g., `openssl rand -hex 32`)
2. **One token per user/team**: Easier to revoke access if needed
3. **HTTPS only**: Always use `--letsencrypt` in production
4. **Rotate tokens periodically**: Update tokens and notify users

---

# 🛡️ IP Access Control

Control which IP addresses can connect to your server. By default, all IPs are allowed.

## Access Modes

| Mode | Description |
|------|-------------|
| `all` | Allow all IPs (default) |
| `allowlist` | Only allow IPs in the allow list |
| `denylist` | Deny IPs in the deny list, allow others |

## Command Line

```bash
# Only allow specific IPs/ranges
opentunnel server -d --domain example.com --ip-mode allowlist --ip-allow "192.168.1.0/24,10.0.0.1"

# Deny specific IPs
opentunnel server -d --domain example.com --ip-mode denylist --ip-deny "1.2.3.4,5.6.7.0/24"
```

## Configuration File

```yaml
server:
  domain: example.com
  token: ${AUTH_TOKEN}
  ipAccess:
    mode: allowlist                       # all, allowlist, or denylist
    allowList:
      - 192.168.1.0/24                    # Allow entire subnet
      - 10.0.0.1                          # Allow single IP
      - 172.16.0.0/16                     # Allow another range
```

```yaml
server:
  domain: example.com
  ipAccess:
    mode: denylist
    denyList:
      - 1.2.3.4                           # Block single IP
      - 5.6.7.0/24                        # Block entire subnet
```

## Supported Formats

- Single IP: `192.168.1.1`
- CIDR notation: `192.168.1.0/24` (256 addresses)
- IPv6: `::1`, `2001:db8::/32`

---

# 📄 Configuration File

Create `opentunnel.yml` in your project directory.

## Environment Variables

OpenTunnel supports **Docker-style environment variable substitution** in config files. Variables are loaded from `.env` file automatically.

| Syntax | Description |
|--------|-------------|
| `${VAR}` | Use value of VAR |
| `${VAR:-default}` | Use VAR if set, otherwise use "default" |
| `${VAR:=default}` | Same as above (alternative syntax) |

**Example with `.env` file:**

```env
# .env
AUTH_TOKEN=my-secret-token
SERVER_DOMAIN=example.com
```

```yaml
# opentunnel.yml
server:
  remote: ${SERVER_DOMAIN:-localhost}    # Uses example.com from .env
  token: ${AUTH_TOKEN}                   # Uses my-secret-token from .env

tunnels:
  - name: web
    protocol: http
    port: 3000
    subdomain: app
```

## Client Mode (connect to remote server)

```yaml
server:
  remote: ${SERVER_DOMAIN:-example.com}  # Base domain (system adds basePath)
  token: ${AUTH_TOKEN}                   # From .env (optional)

tunnels:
  - name: frontend
    protocol: http
    port: 3000
    subdomain: app                       # → app.op.example.com

  - name: backend
    protocol: http
    port: 4000
    subdomain: api                       # → api.op.example.com

  - name: database
    protocol: tcp
    port: 5432
    remotePort: 15432                    # → example.com:15432
    autostart: false                     # Don't start automatically
```

## Server Mode (run your own server)

```yaml
server:
  domain: ${DOMAIN:-example.com}         # Base domain only
  token: ${AUTH_TOKEN}                   # Optional: for private server
  # tcpPortMin: 10000                    # TCP tunnel port range (optional)
  # tcpPortMax: 20000
```

## Commands

```bash
opentunnel init       # Create example config file
opentunnel up         # Start server/tunnels from config
opentunnel up -d      # Start in background
opentunnel down       # Stop everything
opentunnel stop       # Stop server
opentunnel ps         # Show running processes
```

---

# 📖 Commands Reference

| Command | Description |
|---------|-------------|
| `opentunnel quick <port> -s <domain>` | Quick tunnel to a server |
| `opentunnel http <port>` | HTTP tunnel with options |
| `opentunnel tcp <port>` | TCP tunnel with options |
| `opentunnel server -d` | Start tunnel server in background |
| `opentunnel up` | Start from opentunnel.yml |
| `opentunnel down` | Stop all tunnels |
| `opentunnel stop` | Stop server |
| `opentunnel ps` | List running processes |
| `opentunnel init` | Create config file |

## Quick Command

```bash
opentunnel quick <port> -s <domain> [options]

Required:
  -s, --server <domain>       Server base domain (e.g., example.com)

Options:
  -b, --base-path <path>      Server base path (default: op, empty for direct)
  -n, --subdomain <name>      Request specific subdomain
  -p, --protocol <proto>      http, https, or tcp (default: http)
  -h, --host <host>           Local host (default: localhost)
  -t, --token <token>         Authentication token
  --insecure                  Skip SSL verification (self-signed certs)
```

## HTTP/TCP Commands

```bash
opentunnel http <port> [options]
opentunnel tcp <port> [options]

Options:
  -s, --server <domain>       Server base domain (e.g., example.com)
  -b, --base-path <path>      Server base path (default: op)
  -t, --token <token>         Authentication token
  -n, --subdomain <name>      Custom subdomain
  -h, --host <host>           Local host (default: localhost)
  -r, --remote-port <port>    Remote TCP port (tcp only)
  -d, --detach                Run in background
```

---

# 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         INTERNET                                 │
│                                                                  │
│   Users access: https://myapp.op.example.com                    │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                    OpenTunnel Server                             │
│                    (op.example.com)                             │
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

- ✅ Personal, educational, and commercial use allowed
- ❌ No forks or redistribution without permission
- ❌ No reselling or monetization without explicit consent

Contact FJRG2007 for licensing questions.
