# Commands Reference

## Overview

| Command | Description |
|---------|-------------|
| `opentunnel expl <port>` | Expose port via local server |
| `opentunnel quick <port>` | Quick tunnel to a server |
| `opentunnel http <port>` | HTTP tunnel |
| `opentunnel tcp <port>` | TCP tunnel |
| `opentunnel server` | Start tunnel server |
| `opentunnel up` | Start from config file |
| `opentunnel down` | Stop all tunnels |
| `opentunnel restart` | Restart tunnels |
| `opentunnel stop` | Stop server |
| `opentunnel ps` | List running processes |
| `opentunnel init` | Create config file |
| `opentunnel setdomain` | Set default domain |
| `opentunnel getdomain` | Show default domain |
| `opentunnel cleardomain` | Remove default domain |
| `opentunnel login` | Authenticate with a provider |
| `opentunnel logout` | Remove stored credentials |
| `opentunnel create` | Create a named tunnel |
| `opentunnel delete` | Delete a named tunnel |
| `opentunnel tunnels` | List named tunnels |
| `opentunnel route` | Route DNS to a tunnel |
| `opentunnel config` | Manage configuration |

## Expose Local (expl)

Starts a local server and creates a tunnel automatically.

```bash
opentunnel expl <port> [options]

Options:
  -s, --domain <domain>       Server domain (uses default if not set)
  -b, --base-path <path>      Server base path (default: op)
  -n, --subdomain <name>      Request specific subdomain
  -p, --protocol <proto>      http, https, or tcp (default: http)
  -h, --host <host>           Local host (default: localhost)
  -t, --token <token>         Authentication token
  --insecure                  Skip SSL verification
  --server-port <port>        Local server port (default: 443)
```

**Examples:**
```bash
opentunnel expl 3000
opentunnel expl 3000 -s example.com
opentunnel expl 3000 -n myapp
```

## Quick Command

```bash
opentunnel quick <port> [options]

Required:
  -s, --domain <domain>       Server domain

Options:
  -b, --base-path <path>      Server base path (default: op)
  -n, --subdomain <name>      Request specific subdomain
  -p, --protocol <proto>      http, https, or tcp (default: http)
  -h, --host <host>           Local host (default: localhost)
  -t, --token <token>         Authentication token
  --insecure                  Skip SSL verification
  --local-server              Start local server (hybrid mode)
  --server-port <port>        Local server port (default: 443)
```

## HTTP/TCP Commands

```bash
opentunnel http <port> [options]
opentunnel tcp <port> [options]

Required:
  -s, --domain <domain>       Server domain

Options:
  -b, --base-path <path>      Server base path (default: op)
  -t, --token <token>         Authentication token
  -n, --subdomain <name>      Custom subdomain
  -h, --host <host>           Local host (default: localhost)
  -r, --remote-port <port>    Remote TCP port (tcp only)
  --insecure                  Skip SSL verification

Third-party Tunnels:
  --ngrok                     Use ngrok instead of OpenTunnel
  --region <region>           Ngrok region (us, eu, ap, au, sa, jp, in)
  --cloudflare, --cf          Use Cloudflare Tunnel instead of OpenTunnel
  --cf-hostname <hostname>    Custom hostname for Cloudflare (requires setup)
```

**Examples with third-party tunnels:**
```bash
# Using ngrok
opentunnel http 3000 --ngrok
opentunnel http 3000 --ngrok --region eu

# Using Cloudflare Tunnel
opentunnel http 3000 --cloudflare
opentunnel http 3000 --cf
```

## Server Command

```bash
opentunnel server [options]

Required:
  --domain <domain>           Base domain

Optional:
  -p, --port <port>           Server port (default: 443)
  -b, --base-path <path>      Subdomain prefix (default: op)
  --tcp-min <port>            Min TCP port (default: 10000)
  --tcp-max <port>            Max TCP port (default: 20000)
  -d, --detach                Run in background

Authentication:
  --auth-tokens <tokens>      Comma-separated tokens

SSL/TLS:
  --letsencrypt               Enable Let's Encrypt
  --email <email>             Let's Encrypt email
  --production                Production certificates
  --cloudflare-token <token>  DNS-01 challenge

IP Access Control:
  --ip-mode <mode>            all, allowlist, or denylist
  --ip-allow <ips>            IPs/CIDRs to allow
  --ip-deny <ips>             IPs/CIDRs to deny

Dymo API:
  --dymo-api-key <key>        Enable fraud detection
  --dymo-block-proxies        Block proxy/VPN IPs
  --dymo-block-hosting        Block datacenter IPs
  --no-dymo-block-bots        Allow bot user agents
  --no-dymo-cache             Disable caching
  --dymo-cache-ttl <seconds>  Cache TTL (default: 300)
```

## Domain Configuration

```bash
# Set default domain
opentunnel setdomain example.com
opentunnel setdomain example.com -b op

# View configuration
opentunnel getdomain

# Remove default
opentunnel cleardomain
```

Stored in `~/.opentunnel/config.json`:
```json
{
  "defaultDomain": {
    "domain": "example.com",
    "basePath": "op"
  }
}
```

## Background Mode

```bash
# Start instances
opentunnel up -d
opentunnel up production -d
opentunnel up staging -d

# List running
opentunnel ps

# Restart
opentunnel restart
opentunnel restart production

# Stop
opentunnel down production
opentunnel down
```

## Authentication Commands

Unified authentication for all providers.

### Login

```bash
# Cloudflare - opens browser for OAuth
opentunnel login cloudflare
opentunnel login cf  # alias

# ngrok - provide your authtoken
opentunnel login ngrok --token YOUR_TOKEN
```

### Logout

```bash
opentunnel logout cloudflare
opentunnel logout ngrok
```

Credentials are stored at `~/.opentunnel/credentials.json` with secure file permissions (0600).

## Named Tunnel Management

Create and manage named tunnels. Use `--cf` or `--provider cloudflare` to specify the provider.

### Create

```bash
opentunnel create my-tunnel --cf
opentunnel create my-tunnel --provider cloudflare
```

### List

```bash
opentunnel tunnels --cf
```

### Delete

```bash
opentunnel delete my-tunnel --cf
opentunnel delete my-tunnel --cf --force  # skip confirmation
```

### Route DNS

```bash
opentunnel route my-tunnel app.example.com --cf
```

## Using Named Tunnels

The `-n` flag works as the tunnel name when using Cloudflare:

```bash
# Quick tunnel (random URL)
opentunnel http 3000 --cf

# Named tunnel (persistent URL)
opentunnel http 3000 --cf -n my-tunnel

# With provider flag
opentunnel http 3000 --provider cloudflare -n my-tunnel
```

In your config file:

```yaml
provider: cloudflare

cloudflare:
  tunnelName: my-tunnel  # Default for all tunnels

tunnels:
  - name: web
    protocol: http
    port: 3000
    # Uses my-tunnel

  - name: api
    port: 4000
    subdomain: api-tunnel  # Override: uses api-tunnel instead
```

## Config Commands

Manage OpenTunnel configuration values.

```bash
# Set a value
opentunnel config set ngrok.token YOUR_TOKEN
opentunnel config set cloudflare.accountId YOUR_ACCOUNT_ID

# Get a value
opentunnel config get ngrok.token

# List all stored config
opentunnel config list
```

**Available keys:**

| Key | Description |
|-----|-------------|
| `ngrok.token` | ngrok authentication token |
| `cloudflare.accountId` | Cloudflare account ID |
| `cloudflare.tunnelToken` | Cloudflare tunnel token |
| `cloudflare.certPath` | Path to cloudflared cert.pem |

**Credential Priority:**

1. CLI flags (highest)
2. Environment variables (`NGROK_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`)
3. YAML config (`opentunnel.yml`)
4. Stored credentials (`~/.opentunnel/credentials.json`)

Credentials are stored at `~/.opentunnel/credentials.json` with secure file permissions (0600).

## See Also

- [Client Guide](client-guide.md)
- [Server Guide](server-guide.md)
- [Configuration](configuration.md)
- [Cloudflare Tunnel Setup](cloudflare-tunnel.md)
