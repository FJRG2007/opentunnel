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

## Tunnel Options

| Option | Type | Description |
|--------|------|-------------|
| `name` | string | Tunnel identifier |
| `protocol` | string | http, https, or tcp |
| `port` | number | Local port |
| `subdomain` | string | Requested subdomain |
| `remotePort` | number | Remote TCP port |
| `autostart` | boolean | Start automatically (default: true) |

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
- [IP Access Control](ip-access-control.md)
- [Firewall with Dymo API](firewall-dymo-api.md)
