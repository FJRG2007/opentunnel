<h1 align="center">OpenTunnel</h1>

<p align="center">Self-hosted alternative to ngrok. Expose local services to the internet with custom subdomains, or use ngrok/Cloudflare Tunnel.</p>

---

## Table of Contents

- [Quick Start](#quick-start)
  - [Installation](#installation)
  - [As a Client](#as-a-client)
  - [As a Server](#as-a-server)
  - [Home Use (Hybrid Mode)](#home-use-hybrid-mode)
  - [Using ngrok or Cloudflare Tunnel](#using-ngrok-or-cloudflare-tunnel)
  - [Authentication & Named Tunnels](#authentication--named-tunnels)
- [Configuration File](#configuration-file)
  - [Client Mode](#client-mode-config)
  - [Server Mode](#server-mode-config)
  - [Hybrid Mode](#hybrid-mode-config)
- [CLI Commands](#cli-commands)
- [Streaming Large Files / Video](#streaming-large-files--video)
- [Documentation](#documentation)
- [Architecture](#architecture)
- [Troubleshooting](#troubleshooting-quick)
- [License](#license)

---

## Quick Start

### Installation

```bash
npm install -g opentunnel-cli
```

### As a Client

Connect to an existing OpenTunnel server:

```bash
# Quick tunnel
opentunnel quick 3000 -s example.com

# With authentication
opentunnel quick 3000 -s example.com -t YOUR_TOKEN

# Custom subdomain
opentunnel quick 3000 -s example.com -n myapp
# → https://myapp.op.example.com
```

### As a Server

Host your own tunnel server:

```bash
# Basic server (port 443 by default, self-signed SSL)
sudo opentunnel server -d --domain example.com

# With Let's Encrypt SSL (recommended for production)
sudo opentunnel server -d --domain example.com --letsencrypt --email admin@example.com

# With authentication (recommended)
sudo opentunnel server -d --domain example.com --auth-tokens "YOUR_SECRET_TOKEN"

# Custom port (if 443 is occupied)
opentunnel server -d --domain example.com --port 8443
```

**Note:** Ports below 1024 (like 443) require `sudo` on Linux/macOS, or Administrator on Windows.

**DNS Setup:** Point `op.example.com` and `*.op.example.com` to your server IP.

### Home Use (Hybrid Mode)

Run server + tunnel in one terminal:

```bash
# Set default domain (one time)
opentunnel setdomain yourdomain.com

# Expose any port
opentunnel expl 3000
```

### Using ngrok or Cloudflare Tunnel

Don't have a server? Use third-party tunnel providers:

```bash
# With Cloudflare Tunnel (free, no account needed for quick tunnels)
opentunnel http 3000 --cloudflare
opentunnel http 3000 --cf

# With ngrok
opentunnel http 3000 --ngrok
opentunnel http 3000 --ngrok --region eu
```

### Authentication & Named Tunnels

Store credentials securely and manage Cloudflare named tunnels:

```bash
# Login to providers
opentunnel login cloudflare       # Opens browser for OAuth
opentunnel login ngrok --token YOUR_TOKEN

# Create and manage named tunnels
opentunnel create my-tunnel --cf
opentunnel tunnels --cf
opentunnel route my-tunnel app.example.com
opentunnel delete my-tunnel --cf

# Use named tunnel with -n flag
opentunnel http 3000 --cf -n my-tunnel

# View stored credentials
opentunnel config list
```

---

## Configuration File

Create `opentunnel.yml` in your project directory:

### Client Mode Config

Connect to a remote OpenTunnel server:

```yaml
server:
  remote: example.com
  token: YOUR_SECRET_TOKEN

tunnels:
  - name: webapp
    protocol: http
    port: 3000
    subdomain: myapp

  - name: api
    protocol: http
    port: 4000
    subdomain: api

  - name: media
    protocol: http
    port: 8080
    subdomain: media
    streaming: true        # Enable streaming mode (10 min timeout)
    # requestTimeout: 0    # Or no timeout (use with caution)
```

### Server Mode Config

Run your own tunnel server:

```yaml
mode: server

server:
  domain: example.com
  port: 443
  https: true
  auth:
    required: true
    tokens:
      - "SECRET_TOKEN_1"
      - "SECRET_TOKEN_2"
```

### Hybrid Mode Config

Run server + tunnels in one process (ideal for home use):

```yaml
mode: hybrid

server:
  domain: yourdomain.com
  port: 443

tunnels:
  - name: webapp
    protocol: http
    port: 3000
    subdomain: app

  - name: homeassistant
    protocol: http
    port: 8123
    subdomain: home
```

**Start with:** `opentunnel up`

---

## CLI Commands

| Command | Description |
|---------|-------------|
| `opentunnel quick <port>` | Quick tunnel to a local port |
| `opentunnel http <port>` | HTTP tunnel (supports --ngrok, --cloudflare) |
| `opentunnel server` | Start a tunnel server |
| `opentunnel up` | Start from opentunnel.yml |
| `opentunnel down` | Stop running instances |
| `opentunnel ps` | List running instances |
| `opentunnel stop` | Stop background server |
| `opentunnel status` | Check server status |
| `opentunnel logs` | View server logs |

**Server options:**
- `-d, --detach` - Run in background
- `--domain <domain>` - Server domain
- `--port <port>` - Listen port (default: 443)
- `--auth-tokens <tokens>` - Comma-separated auth tokens
- `--letsencrypt` - Enable Let's Encrypt SSL
- `--cloudflare-token` - Cloudflare API token for DNS
- `--no-http-redirect` - Disable automatic HTTP→HTTPS redirect on port 80

**Client options:**
- `-s, --server <url>` - Server URL
- `-t, --token <token>` - Auth token
- `-n, --name <name>` - Custom subdomain
- `--insecure` - Skip SSL verification
- `--streaming` - Enable streaming mode (10 min timeout for video/large files)
- `--timeout <ms>` - Custom request timeout in milliseconds (0 = no timeout)

---

## Streaming Large Files / Video

For tunneling video streams or large file downloads, use the streaming options:

```bash
# Enable streaming mode (10 minute timeout)
opentunnel http 8080 -s example.com --streaming

# Custom timeout (5 minutes = 300000ms)
opentunnel http 8080 -s example.com --timeout 300000

# No timeout (use with caution - high memory usage)
opentunnel http 8080 -s example.com --timeout 0
```

**In configuration file:**

```yaml
tunnels:
  - name: media-server
    protocol: http
    port: 8080
    subdomain: media
    streaming: true          # 10 min timeout
    # requestTimeout: 300000 # Or custom timeout in ms
```

> **Note:** HTTP tunnels buffer the entire response in memory before forwarding. For very large files (>500MB), consider using TCP tunnels which stream byte-by-byte:
> ```bash
> opentunnel tcp 8080 -s example.com
> ```

---

## Troubleshooting Quick

### Port already in use

**Linux/macOS:**
```bash
lsof -i :443
netstat -tlnp | grep :443
```

**Windows (PowerShell):**
```powershell
netstat -ano | findstr :443
Get-Process -Id (Get-NetTCPConnection -LocalPort 443).OwningProcess
```

### Server stop not working

If you started the server with elevated privileges, stop it the same way:

**Linux/macOS:**
```bash
sudo opentunnel stop
```

**Windows:**
Run as Administrator.

### Client can't connect

1. Check firewall allows the port
2. Verify DNS points to your server
3. Use `--insecure` for self-signed certs

See [Troubleshooting Guide](docs/troubleshooting.md) for more.

---

## Documentation

| Guide | Description |
|-------|-------------|
| [Client Guide](docs/client-guide.md) | Complete client usage and options |
| [Server Guide](docs/server-guide.md) | Server deployment and configuration |
| [Commands Reference](docs/commands.md) | All CLI commands and options |
| [Configuration File](docs/configuration.md) | opentunnel.yml reference |
| [Troubleshooting](docs/troubleshooting.md) | Common issues and solutions |
| [Home Use Guide](docs/home-use-guide.md) | Running from home with port forwarding |
| [Domain Setup](docs/domain-setup.md) | DNS and SSL configuration |
| [DuckDNS & Free DNS](docs/duckdns-setup.md) | Free DNS services setup |
| [Cloudflare Tunnel](docs/cloudflare-tunnel.md) | Cloudflare Tunnel & named tunnels |
| [Multi-Domain](docs/multi-domain.md) | Multiple domains on one server |
| [Authentication](docs/authentication.md) | Token-based authentication |
| [IP Access Control](docs/ip-access-control.md) | Allow/deny IP ranges (cross-provider) |
| [Firewall (Dymo API)](docs/firewall-dymo-api.md) | Fraud detection and bot protection |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         INTERNET                                │
│   Users access: https://myapp.op.example.com                   │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                    OpenTunnel Server                            │
│                    (op.example.com)                             │
│   - Routes by subdomain                                         │
│   - Forwards via WebSocket                                      │
└──────────────────────────────┬──────────────────────────────────┘
                               │ WebSocket
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Your Computer                              │
│                  (behind NAT/firewall)                          │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│   │  Web App     │  │  API Server  │  │  Database    │         │
│   │  :3000       │  │  :4000       │  │  :5432       │         │
│   └──────────────┘  └──────────────┘  └──────────────┘         │
└─────────────────────────────────────────────────────────────────┘
```

---

## License

[Proprietary License](LICENSE) - All rights reserved.

- ✅ Personal, educational, and commercial use allowed
- ❌ No forks or redistribution without permission
- ❌ No reselling without explicit consent

Contact FJRG2007 for licensing questions.
