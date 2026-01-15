<h1 align="center">OpenTunnel</h1>

<p align="center">Self-hosted alternative to ngrok. Expose local services to the internet with custom subdomains.</p>

---

## Table of Contents

- [As a Client](#-as-a-client) - Expose your local ports
- [As a Server](#-as-a-server) - Host your own tunnel server
- [Home Use](#-home-use-behind-routernat) - Run from home network
- [Multi-Domain Support](#-multi-domain-support) - Handle multiple domains on one server
- [Authentication](#-authentication) - Secure your server
- [IP Access Control](#-ip-access-control) - Allow/deny IPs and CIDR ranges
- [Configuration File](#-configuration-file) - opentunnel.yml reference
  - [Environment Variables](#environment-variables) - Docker-style ${VAR:-default} syntax
- [Commands Reference](#-commands-reference)
  - [Expose Local (expl)](#expose-local-command-expl) - Fastest way to expose a port
  - [Domain Configuration](#domain-configuration) - Set default domain

---

# 📱 As a Client

Use OpenTunnel to expose your local services to the internet. Connect to any OpenTunnel server (your own or one shared with you).

## Installation

```bash
# NPM (recommended)
npm cache clean --force && npm install -g opentunnel-cli

# Or use without installing
npx opentunnel-cli quick 3000 -s example.com
```

## Quick Start

### Option 1: Expose Local (Recommended for Home Use)

The fastest way to expose a port with your own domain:

```bash
# First, set your default domain (one time only)
opentunnel setdomain yourdomain.com

# Then expose any port with a single command
opentunnel expl 3000
```

This starts a local server and exposes your port. Requires your domain to point to your machine (with port forwarding if behind NAT).
[Check this](#-home-use-behind-routernat) - Run from home network

### Option 2: Quick Command

Connect to an existing OpenTunnel server:

```bash
# Connect to a remote OpenTunnel server
opentunnel quick 3000 -s example.com

# Or start your own local server
opentunnel quick 3000 -s yourdomain.com --local-server
```

Your local port 3000 is now accessible from the internet:

```
  Status:    ● Online
  Local:     localhost:3000
  Public:    https://myapp.op.example.com
```

**Options:**
```bash
opentunnel quick 3000 -s example.com                    # Basic HTTP tunnel
opentunnel quick 3000 --domain example.com -n myapp     # Custom subdomain
opentunnel quick 5432 -s example.com -p tcp             # TCP tunnel
opentunnel quick 3000 -s example.com -t SECRET          # With auth token
opentunnel quick 3000 -s example.com --insecure         # Self-signed cert
opentunnel quick 3000 -s example.com -b ""              # No basePath (direct domain)
opentunnel quick 3000 -s yourdomain.com --local-server  # Start server + tunnel in one terminal
# 
```

### Option 3: HTTP/TCP Commands

More control with specific commands:

```bash
# HTTP tunnel
opentunnel http 3000 -s example.com
opentunnel http 3000 --domain example.com --subdomain myapp

# With authentication
opentunnel http 3000 -s example.com -t SECRET

# TCP tunnel
opentunnel tcp 5432 -s example.com -r 15432
opentunnel tcp 5432 --domain example.com --remote-port 15432
```

### Option 4: Using Config File

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
npm cache clean --force && npm install -g opentunnel-cli

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

# 🏠 Home Use (Behind Router/NAT)

If you want to run OpenTunnel server from your home network, you need to configure your router properly.

## Step 1: Static Internal IP

First, assign a static IP to your computer in your router's DHCP settings. This prevents your IP from changing after a reboot.

**Example:** `192.168.1.134`

Most routers have this in: **Settings → LAN → DHCP Reservation** or **Address Reservation**

## Step 2: Port Forwarding

Configure your router to forward external ports to your computer:

| Name | Protocol | WAN Port | LAN Host | LAN Port | Description |
|------|----------|----------|----------|----------|-------------|
| OpenTunnel HTTP | TCP/UDP | 80 | 192.168.1.134 | 8080 | Let's Encrypt HTTP-01 challenge |
| OpenTunnel HTTPS | TCP | 443 | 192.168.1.134 | 443 | Main HTTPS traffic |
| OpenTunnel TCP | TCP/UDP | 10000-20000 | 192.168.1.134 | 10000-20000 | TCP tunnel ports |

> **Note:** Replace `192.168.1.134` with your computer's static IP.

## Step 3: Dynamic DNS (Optional)

If you don't have a static public IP, use a dynamic DNS service:

- **DuckDNS** (free): `yourdomain.duckdns.org`
- **Cloudflare** (free tier): Use with your own domain
- **No-IP**, **DynDNS**, etc.

## Step 4: Start the Server

```bash
# With Let's Encrypt (recommended)
opentunnel server -d --domain yourdomain.duckdns.org --letsencrypt --email you@email.com --production

# With self-signed certificate (for testing)
opentunnel server -d --domain yourdomain.duckdns.org
```

## Step 5: Connect from Anywhere

From any other network:

```bash
opentunnel quick 3000 -s yourdomain.duckdns.org
```

## Quick Hybrid Mode (Server + Tunnel in One)

For the simplest setup, expose a local port while running the server:

```bash
# Easiest: set default domain once, then use expl
opentunnel setdomain yourdomain.duckdns.org
opentunnel expl 3000

# Or specify domain each time
opentunnel expl 3000 -s yourdomain.duckdns.org

# Alternative with quick command
opentunnel quick 3000 -s yourdomain.duckdns.org --local-server

# Or with config file
opentunnel init --hybrid
opentunnel up
```

## Troubleshooting

**Ports not accessible from outside:**
1. Check your ISP doesn't block ports 80/443 (some do for residential)
2. Verify port forwarding rules are active
3. Test from a different network (not from inside your home network)
4. Check Windows Firewall / Linux iptables rules

**Use alternative ports if ISP blocks 80/443:**
```bash
opentunnel server -d --domain yourdomain.com -p 8443 --public-port 8443
```

---

# 🌐 Multi-Domain Support

OpenTunnel can handle **multiple domains** on a single server instance. Each domain works independently - clients connect to whichever domain they prefer and create their own tunnels.

## DNS Configuration

For each domain you want to use, create DNS records pointing to your server:

| Domain | Type | Name | Value |
|--------|------|------|-------|
| `domain1.com` | A | `op` | `YOUR_SERVER_IP` |
| `domain1.com` | A | `*.op` | `YOUR_SERVER_IP` |
| `domain2.com` | A | `op` | `YOUR_SERVER_IP` |
| `domain2.com` | A | `*.op` | `YOUR_SERVER_IP` |

## Server Configuration

Configure the server with multiple domains in `opentunnel.yml`:

```yaml
server:
  domains:
    - domain: domain1.com
      basePath: op              # Accepts tunnels at: *.op.domain1.com
    - domain: domain2.com
      basePath: op              # Accepts tunnels at: *.op.domain2.com
  port: 443
```

Start the server:
```bash
opentunnel up -d
```

## How Clients Connect

Clients connect to whichever domain they want. Each client creates their own tunnels independently:

**Client A** (connects to domain1.com):
```bash
opentunnel quick 3000 -s domain1.com -n myapp
# → https://myapp.op.domain1.com
```

**Client B** (connects to domain2.com):
```bash
opentunnel quick 8080 -s domain2.com -n api
# → https://api.op.domain2.com
```

**Client C** (also connects to domain1.com):
```bash
opentunnel quick 5000 -s domain1.com -n backend
# → https://backend.op.domain1.com
```

Each tunnel only exists on the domain the client connected to.

## Single Domain (Backward Compatible)

If you only need one domain:

```yaml
server:
  domain: example.com
  basePath: op
```

## Domains Without Wildcard Support (DuckDNS)

Some DNS providers like **DuckDNS** don't support wildcard subdomains (`*.domain`). OpenTunnel automatically detects DuckDNS domains and uses **port-based routing** instead of subdomains.

**Auto-detection:** Domains ending in `.duckdns.org` automatically use port-based mode.

**Important:** DuckDNS domains cannot use `basePath` - it will throw an error:

```yaml
# ❌ WRONG - Will throw an error
server:
  domains:
    - domain: myapp.duckdns.org
      basePath: op              # Error! DuckDNS doesn't support subdomains

# ✅ CORRECT
server:
  domains:
    - domain: fjrg2007.com
      basePath: op              # Subdomain-based: *.op.fjrg2007.com
    - domain: myapp.duckdns.org
                                # Port-based: myapp.duckdns.org:<port>
```

**Manual configuration:** Use `wildcard: false` for other domains without wildcard support:

```yaml
server:
  domains:
    - domain: fjrg2007.com
      basePath: op              # Subdomain-based: *.op.fjrg2007.com
    - domain: other-no-wildcard.com
      wildcard: false           # Manual: port-based
```

**How it works:**
- **Wildcard domains:** `https://myapp.op.fjrg2007.com`
- **Non-wildcard domains:** `https://myapp.duckdns.org:10001`

Clients connecting to non-wildcard domains receive port-based URLs automatically.

## SSL Certificates

When using self-signed certificates with multiple domains, OpenTunnel automatically generates a **SAN (Subject Alternative Name) certificate** that covers all configured domains and their wildcards.

For Let's Encrypt, you'll need separate certificates or a multi-domain certificate with all your domains listed.

## Use Cases

### Different Teams/Projects

```yaml
server:
  domains:
    - domain: dev.company.com
      basePath: op              # Dev team connects here
    - domain: staging.company.com
      basePath: op              # QA team connects here
```

### White-Label Service

```yaml
server:
  domains:
    - domain: client1.com
      basePath: op              # Client 1's tunnels
    - domain: client2.com
      basePath: op              # Client 2's tunnels
```

### Migration Between Domains

```yaml
server:
  domains:
    - domain: newdomain.com
      basePath: op              # New domain
    - domain: olddomain.com
      basePath: op              # Old domain (still supported)
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

## Hybrid Mode (server + tunnels in one terminal)

For home use or development, you can run the server AND expose local ports in the same terminal without needing a separate server process.

```yaml
mode: hybrid                             # Server + tunnels in one terminal

server:
  domain: ${DOMAIN:-example.com}         # Your domain
  token: ${AUTH_TOKEN}                   # Optional

tunnels:
  - name: web
    protocol: http
    port: 3000
    subdomain: web                       # → web.op.example.com

  - name: api
    protocol: http
    port: 4000
    subdomain: api                       # → api.op.example.com
```

```bash
opentunnel up         # Starts server + all tunnels
```

**Quick hybrid start (no config file):**
```bash
# Easiest way (with default domain set)
opentunnel expl 3000

# Or with explicit domain
opentunnel expl 3000 -s yourdomain.com

# Alternative
opentunnel quick 3000 -s yourdomain.com --local-server
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
| `opentunnel expl <port>` | Expose local port via local server (uses default domain) |
| `opentunnel quick <port> -s <domain>` | Quick tunnel to a server |
| `opentunnel http <port>` | HTTP tunnel with options |
| `opentunnel tcp <port>` | TCP tunnel with options |
| `opentunnel server -d` | Start tunnel server in background |
| `opentunnel up` | Start from opentunnel.yml |
| `opentunnel down` | Stop all tunnels |
| `opentunnel restart` | Restart tunnels (down + up) |
| `opentunnel stop` | Stop server |
| `opentunnel ps` | List running processes |
| `opentunnel init` | Create config file |
| `opentunnel setdomain <domain>` | Set default domain for expl command |
| `opentunnel getdomain` | Show current default domain |
| `opentunnel cleardomain` | Remove default domain configuration |

## Expose Local Command (expl)

The simplest way to expose a local port. Starts a local server and creates a tunnel automatically.

```bash
opentunnel expl <port> [options]

Options:
  -s, --domain <domain>       Server domain (uses default if not specified)
  -b, --base-path <path>      Server base path (default: op)
  -n, --subdomain <name>      Request specific subdomain
  -p, --protocol <proto>      http, https, or tcp (default: http)
  -h, --host <host>           Local host (default: localhost)
  -t, --token <token>         Authentication token
  --insecure                  Skip SSL verification
  --server-port <port>        Port for local server (default: 443)
```

**Examples:**
```bash
# With default domain configured
opentunnel expl 3000

# With explicit domain
opentunnel expl 3000 -s example.com

# With subdomain
opentunnel expl 3000 -n myapp
```

## Domain Configuration

Set a default domain so you don't need to specify `-s` every time:

```bash
# Set default domain
opentunnel setdomain example.com
opentunnel setdomain example.com -b op    # with custom base path

# View current configuration
opentunnel getdomain

# Remove default domain
opentunnel cleardomain
```

Configuration is stored in `~/.opentunnel/config.json`:
```json
{
  "defaultDomain": {
    "domain": "example.com",
    "basePath": "op"
  }
}
```

## Quick Command

```bash
opentunnel quick <port> [options]

Required:
  -s, --domain <domain>       Server domain (e.g., example.com)

Options:
  -b, --base-path <path>      Server base path (default: op, empty for direct)
  -n, --subdomain <name>      Request specific subdomain
  -p, --protocol <proto>      http, https, or tcp (default: http)
  -h, --host <host>           Local host (default: localhost)
  -t, --token <token>         Authentication token
  --insecure                  Skip SSL verification (self-signed certs)
  --local-server              Start a local server (use with -s for your domain)
  --server-port <port>        Port for local server (default: 443)
```

## HTTP/TCP Commands

```bash
opentunnel http <port> [options]
opentunnel tcp <port> [options]

Required:
  -s, --domain <domain>       Server domain (e.g., example.com)

Options:
  -b, --base-path <path>      Server base path (default: op)
  -t, --token <token>         Authentication token
  -n, --subdomain <name>      Custom subdomain
  -h, --host <host>           Local host (default: localhost)
  -r, --remote-port <port>    Remote TCP port (tcp only)
  --insecure                  Skip SSL verification
```

## Background Mode

Run multiple instances in the background:

```bash
# Start instances
opentunnel up -d                    # Default instance
opentunnel up production -d         # Named instance "production"
opentunnel up staging -d            # Named instance "staging"

# List running instances
opentunnel ps

# Restart instances
opentunnel restart                  # Restart all in current directory
opentunnel restart production       # Restart specific instance

# Stop instances
opentunnel down production          # Stop specific instance
opentunnel down                     # Stop all instances
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
