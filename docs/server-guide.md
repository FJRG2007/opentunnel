# Server Guide

Host your own OpenTunnel server for full control. Your server can be **public** (anyone can connect) or **private** (requires authentication).

## Requirements

- **VPS or server** with a public IP address
- **Domain** pointing to your server
- **Ports** 443 (HTTPS) and optionally 10000-20000 (TCP tunnels)

## DNS Configuration

Create these DNS records pointing to your server:

| Type | Name | Value |
|------|------|-------|
| A | `op` | `YOUR_SERVER_IP` |
| A | `*.op` | `YOUR_SERVER_IP` |

> **Cloudflare users:** Set proxy status to "DNS only" (gray cloud)

Tunnels will be available at: `https://myapp.op.example.com`

## Deployment Options

### Option 1: Quick Start (CLI)

```bash
# Install
npm install -g opentunnel-cli

# Public server (anyone can connect)
opentunnel server -d --domain example.com --letsencrypt --email admin@example.com

# Private server (requires token)
opentunnel server -d --domain example.com --letsencrypt --email admin@example.com --auth-tokens "SECRET123"

# Stop server
opentunnel stop
```

### Option 2: Configuration File

Create `opentunnel.yml`:

```yaml
server:
  domain: example.com
  # token: SECRET123          # Uncomment for private server
  # tcpPortMin: 10000
  # tcpPortMax: 20000
```

```bash
opentunnel server -d    # Start in background
opentunnel stop         # Stop server
```

### Option 3: Docker

```bash
git clone https://github.com/FJRG2007/opentunnel.git
cd opentunnel
cp .env.example .env
```

Edit `.env`:
```env
DOMAIN=example.com
AUTH_TOKENS=SECRET123
LETSENCRYPT_EMAIL=admin@example.com
LETSENCRYPT_PRODUCTION=true
```

```bash
docker-compose up -d
docker-compose down
```

### Option 4: Systemd (Linux)

```bash
curl -fsSL https://raw.githubusercontent.com/FJRG2007/opentunnel/main/deploy/install.sh | sudo bash
sudo nano /opt/opentunnel/.env
sudo systemctl start opentunnel
```

## Server Options

```bash
opentunnel server [options]

Required:
  --domain <domain>           Your base domain

Optional:
  -p, --port <port>           Server port (default: 443)
  -b, --base-path <path>      Subdomain prefix (default: op)
  --tcp-min <port>            Min TCP tunnel port (default: 10000)
  --tcp-max <port>            Max TCP tunnel port (default: 20000)
  -d, --detach                Run in background

Authentication:
  --auth-tokens <tokens>      Comma-separated tokens

SSL/TLS:
  --letsencrypt               Enable Let's Encrypt
  --email <email>             Email for Let's Encrypt
  --production                Use production certificates
  --cloudflare-token <token>  For DNS-01 challenge

IP Access Control:
  --ip-mode <mode>            all, allowlist, or denylist
  --ip-allow <ips>            IPs/CIDRs to allow
  --ip-deny <ips>             IPs/CIDRs to deny

Dymo API (Fraud Detection):
  --dymo-api-key <key>        Enable Dymo API verification
  --dymo-block-proxies        Block proxy/VPN IPs
  --dymo-block-hosting        Block datacenter IPs
  --no-dymo-block-bots        Allow bot user agents
```

## Server Modes

### Public Server

```bash
opentunnel server -d --domain example.com --letsencrypt --email admin@example.com
```

Clients connect without token:
```bash
opentunnel quick 3000 -s example.com
```

### Private Server

```bash
opentunnel server -d --domain example.com --auth-tokens "token1,token2"
```

Clients must provide token:
```bash
opentunnel quick 3000 -s example.com -t token1
```

## See Also

- [Domain Setup](domain-setup.md) - DNS configuration details
- [DuckDNS Setup](duckdns-setup.md) - Free DNS services
- [Home Use Guide](home-use-guide.md) - Running from home
- [Authentication](authentication.md) - Token management
- [IP Access Control](ip-access-control.md) - Allow/deny IPs
- [Firewall with Dymo API](firewall-dymo-api.md) - Fraud detection
- [Multi-Domain Support](multi-domain.md) - Multiple domains
