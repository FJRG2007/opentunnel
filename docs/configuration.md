# Configuration File Reference

Create `opentunnel.yml` in your project directory.

## Environment Variables

OpenTunnel supports **Docker-style** variable substitution. Variables load from `.env` automatically.

| Syntax | Description |
|--------|-------------|
| `${VAR}` | Use value of VAR |
| `${VAR:-default}` | Use VAR if set, otherwise "default" |
| `${VAR:=default}` | Same as above |

**Example:**

```env
# .env
AUTH_TOKEN=my-secret-token
SERVER_DOMAIN=example.com
```

```yaml
# opentunnel.yml
server:
  remote: ${SERVER_DOMAIN:-localhost}
  token: ${AUTH_TOKEN}
```

## Tunnel Providers

OpenTunnel supports multiple tunnel providers. Set a global provider or override per-tunnel.

| Provider | Description |
|----------|-------------|
| `opentunnel` | Default. Connect to OpenTunnel server |
| `ngrok` | Use ngrok (requires ngrok installed) |
| `cloudflare` | Use Cloudflare Tunnel (requires cloudflared installed) |

### Using ngrok

```yaml
provider: ngrok

ngrok:
  token: ${NGROK_TOKEN}
  region: eu

tunnels:
  - name: web
    protocol: http
    port: 3000
```

### Using Cloudflare Tunnel

```yaml
provider: cloudflare

tunnels:
  - name: web
    protocol: http
    port: 3000
```

### Using Cloudflare Named Tunnels

For persistent hostnames, use named tunnels (requires `opentunnel login cloudflare` first):

```yaml
provider: cloudflare

cloudflare:
  tunnelName: my-tunnel  # Default named tunnel

tunnels:
  - name: web
    protocol: http
    port: 3000
    # Uses my-tunnel (from cloudflare.tunnelName)

  - name: api
    protocol: http
    port: 4000
    subdomain: api-tunnel  # Override: uses api-tunnel instead
```

The `subdomain` field works as the tunnel name when using Cloudflare provider.

### Mixed Providers

Different providers per tunnel:

```yaml
# Default provider
provider: opentunnel

server:
  remote: example.com
  token: ${AUTH_TOKEN}

# ngrok config (for tunnels using ngrok)
ngrok:
  token: ${NGROK_TOKEN}
  region: us

tunnels:
  # Uses OpenTunnel server (default)
  - name: frontend
    protocol: http
    port: 3000
    subdomain: app

  # Uses ngrok
  - name: backend
    protocol: http
    port: 4000
    provider: ngrok

  # Uses Cloudflare Tunnel
  - name: api
    protocol: http
    port: 5000
    provider: cloudflare
```

## Client Mode

Connect to a remote server:

```yaml
server:
  remote: ${SERVER_DOMAIN:-example.com}
  token: ${AUTH_TOKEN}

tunnels:
  - name: frontend
    protocol: http
    port: 3000
    subdomain: app

  - name: backend
    protocol: http
    port: 4000
    subdomain: api

  - name: database
    protocol: tcp
    port: 5432
    remotePort: 15432
    autostart: false
```

## Server Mode

Run your own server:

```yaml
server:
  domain: ${DOMAIN:-example.com}
  token: ${AUTH_TOKEN}
  tcpPortMin: 10000
  tcpPortMax: 20000
```

## Hybrid Mode

Server + tunnels in one terminal:

```yaml
mode: hybrid

server:
  domain: ${DOMAIN:-example.com}
  token: ${AUTH_TOKEN}

tunnels:
  - name: web
    protocol: http
    port: 3000
    subdomain: web

  - name: api
    protocol: http
    port: 4000
    subdomain: api
```

## Server with Security

```yaml
server:
  domain: example.com
  token: ${AUTH_TOKEN}

  ipAccess:
    mode: allowlist
    allowList:
      - 192.168.1.0/24
      - 10.0.0.0/8

  dymo:
    apiKey: ${DYMO_API_KEY}
    blockBots: true
    blockProxies: false
    blockHosting: false
    cacheResults: true
    cacheTTL: 300
```

## Cross-Provider Security

Apply IP filtering globally or per-tunnel. Works with all providers (OpenTunnel, ngrok, Cloudflare).

```yaml
# Global security (applies to all tunnels)
security:
  ipAccess:
    mode: denylist
    denyList:
      - 1.2.3.4
      - 5.6.7.0/24

tunnels:
  - name: api
    port: 4000
    provider: cloudflare
    # Inherits global ipAccess

  - name: admin
    port: 5000
    provider: ngrok
    # Override with tunnel-specific config
    ipAccess:
      mode: allowlist
      allowList:
        - 10.0.0.0/8
        - 192.168.0.0/16
```

**Note:** For ngrok, IP filtering happens after ngrok forwards the request (documented limitation). True origin filtering requires ngrok's paid IP Policies feature.

## Tunnel Options

| Option | Type | Description |
|--------|------|-------------|
| `name` | string | Tunnel identifier |
| `protocol` | string | http, https, or tcp |
| `port` | number | Local port |
| `subdomain` | string | Subdomain (OpenTunnel/ngrok) or tunnel name (Cloudflare) |
| `remotePort` | number | Remote TCP port |
| `autostart` | boolean | Start automatically (default: true) |
| `provider` | string | Override global provider (opentunnel, ngrok, cloudflare) |
| `ngrokRegion` | string | ngrok region (us, eu, ap, au, sa, jp, in) |
| `ngrokToken` | string | ngrok auth token (overrides global) |
| `cfHostname` | string | Cloudflare custom hostname |
| `ipAccess` | object | Per-tunnel IP filtering (overrides global security) |

**Note:** The `subdomain` field has different meanings:
- **OpenTunnel**: Requested subdomain (e.g., `myapp` → `myapp.op.domain.com`)
- **ngrok**: Requested subdomain (paid feature)
- **Cloudflare**: Named tunnel to use (overrides `cloudflare.tunnelName`)

## Global Options

| Option | Type | Description |
|--------|------|-------------|
| `name` | string | Instance name |
| `mode` | string | server, client, or hybrid |
| `provider` | string | Global tunnel provider (opentunnel, ngrok, cloudflare) |
| `ngrok` | object | Global ngrok config (token, region) |
| `cloudflare` | object | Global cloudflare config (hostname, tunnelName) |
| `security` | object | Global security settings (ipAccess) |

## Cloudflare Options

| Option | Type | Description |
|--------|------|-------------|
| `cloudflare.hostname` | string | Custom hostname for Cloudflare |
| `cloudflare.tunnelName` | string | Default named tunnel to use |

## Security Options

| Option | Type | Description |
|--------|------|-------------|
| `security.ipAccess.mode` | string | all, allowlist, or denylist |
| `security.ipAccess.allowList` | array | IPs/CIDRs to allow |
| `security.ipAccess.denyList` | array | IPs/CIDRs to deny |

## Server Options

| Option | Type | Description |
|--------|------|-------------|
| `domain` | string | Server domain |
| `domains` | array | Multiple domains |
| `basePath` | string | Subdomain prefix (default: op) |
| `port` | number | Server port (default: 443) |
| `token` | string | Auth token (private server) |
| `tcpPortMin` | number | Min TCP port (default: 10000) |
| `tcpPortMax` | number | Max TCP port (default: 20000) |
| `ipAccess` | object | IP access control |
| `dymo` | object | Dymo API configuration |

## Commands

```bash
opentunnel init       # Create example config
opentunnel up         # Start from config
opentunnel up -d      # Start in background
opentunnel down       # Stop everything
opentunnel stop       # Stop server
opentunnel ps         # Show running processes
```

## See Also

- [Commands Reference](commands.md)
- [Cloudflare Tunnel](cloudflare-tunnel.md)
- [IP Access Control](ip-access-control.md)
- [Firewall with Dymo API](firewall-dymo-api.md)
