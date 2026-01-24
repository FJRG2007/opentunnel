# IP Access Control

OpenTunnel provides built-in IP access control to restrict which clients can connect. This works across all providers: OpenTunnel server, ngrok, and Cloudflare Tunnel.

You can allow or deny specific IP addresses or entire network ranges using CIDR notation.

## Access Modes

| Mode | Description |
|------|-------------|
| `all` | Allow all IPs (default) |
| `allowlist` | Only allow IPs in the allowlist |
| `denylist` | Block IPs in the denylist, allow all others |

## Configuration

### Via CLI

```bash
# Allowlist mode - only allow specific IPs
opentunnel server --domain example.com \
  --ip-mode allowlist \
  --ip-allow "192.168.1.0/24,10.0.0.1"

# Denylist mode - block specific IPs
opentunnel server --domain example.com \
  --ip-mode denylist \
  --ip-deny "1.2.3.4,5.6.7.0/24"
```

### Via Configuration File (opentunnel.yml)

```yaml
server:
  domain: example.com
  ipAccess:
    mode: allowlist  # or "denylist" or "all"
    allowList:
      - 192.168.1.0/24
      - 10.0.0.0/8
      - 172.16.0.0/12
    denyList:
      - 1.2.3.4
      - 5.6.7.0/24
```

## CIDR Notation

CIDR (Classless Inter-Domain Routing) notation allows you to specify IP ranges:

| CIDR | Range | Number of IPs |
|------|-------|---------------|
| `192.168.1.0/24` | 192.168.1.0 - 192.168.1.255 | 256 |
| `192.168.0.0/16` | 192.168.0.0 - 192.168.255.255 | 65,536 |
| `10.0.0.0/8` | 10.0.0.0 - 10.255.255.255 | 16,777,216 |
| `192.168.1.1/32` | Single IP: 192.168.1.1 | 1 |

### Common Private Network Ranges

```yaml
# All private networks (RFC 1918)
ipAccess:
  mode: allowlist
  allowList:
    - 10.0.0.0/8       # Class A private
    - 172.16.0.0/12    # Class B private
    - 192.168.0.0/16   # Class C private
    - 127.0.0.0/8      # Localhost
```

## Examples

### Allow Only Local Network

```yaml
server:
  domain: home.example.com
  ipAccess:
    mode: allowlist
    allowList:
      - 192.168.1.0/24  # Home network
      - 127.0.0.1       # Localhost
```

### Block Known Bad Actors

```yaml
server:
  domain: example.com
  ipAccess:
    mode: denylist
    denyList:
      - 1.2.3.4
      - 5.6.7.0/24
      - 10.20.30.0/24
```

### Corporate Network Only

```yaml
server:
  domain: corp.example.com
  ipAccess:
    mode: allowlist
    allowList:
      - 10.0.0.0/8           # Internal network
      - 192.168.100.0/24     # VPN subnet
      - 203.0.113.50         # Office public IP
```

### Combined with Authentication

IP access control works alongside token authentication:

```yaml
server:
  domain: secure.example.com
  token: ${AUTH_TOKEN}
  ipAccess:
    mode: allowlist
    allowList:
      - 192.168.0.0/16
```

Both checks must pass for a connection to be accepted.

## CLI Flags Reference

| Flag | Description |
|------|-------------|
| `--ip-mode <mode>` | Access mode: `all`, `allowlist`, or `denylist` |
| `--ip-allow <ips>` | Comma-separated IPs/CIDRs to allow |
| `--ip-deny <ips>` | Comma-separated IPs/CIDRs to deny |

## How It Works

1. Client connects to the tunnel server
2. Server extracts client IP from:
   - Direct socket connection (`socket.remoteAddress`)
   - Or `X-Forwarded-For` header (if behind a proxy)
3. IP is normalized (IPv6-mapped IPv4 addresses are converted)
4. IP is checked against the configured rules
5. Connection is allowed or denied with code 1008 (Policy Violation)

## IPv6 Support

OpenTunnel handles IPv6-mapped IPv4 addresses automatically. For example, `::ffff:192.168.1.1` is treated as `192.168.1.1`.

## Logs

Denied connections are logged:

```
[Server] Connection denied for IP 1.2.3.4: IP 1.2.3.4 not in allowlist
[Server] Connection denied for IP 5.6.7.8: IP 5.6.7.8 is in denylist
```

## Combining with Dymo API

For advanced protection, combine IP access control with Dymo API:

```yaml
server:
  domain: example.com
  ipAccess:
    mode: denylist
    denyList:
      - 1.2.3.4  # Known bad IP
  dymo:
    apiKey: ${DYMO_API_KEY}
    blockBots: true
```

The order of checks:
1. **IP Access Control** (fast, local)
2. **Dymo API** (external API call)
3. **Authentication** (token check)

## Cross-Provider IP Filtering

IP filtering works with all tunnel providers. Use global security settings or per-tunnel overrides.

### Global Security (All Tunnels)

```yaml
# Applied to all tunnels regardless of provider
security:
  ipAccess:
    mode: denylist
    denyList:
      - 1.2.3.4
      - 5.6.7.0/24

tunnels:
  - name: web
    port: 3000
    provider: cloudflare
    # Inherits global ipAccess

  - name: api
    port: 4000
    provider: ngrok
    # Inherits global ipAccess
```

### Per-Tunnel Override

```yaml
security:
  ipAccess:
    mode: denylist
    denyList:
      - 1.2.3.4

tunnels:
  - name: public
    port: 3000
    provider: cloudflare
    # Uses global config

  - name: admin
    port: 5000
    provider: ngrok
    # Override with stricter rules
    ipAccess:
      mode: allowlist
      allowList:
        - 192.168.0.0/16
        - 10.0.0.0/8
```

### Provider Behavior

| Provider | Filtering Location | Notes |
|----------|-------------------|-------|
| OpenTunnel | TunnelServer | WebSocket + HTTP requests |
| Cloudflare | Proxy server | Before forwarding to local app |
| ngrok | Proxy server | After ngrok forwards (see note) |

**Note for ngrok:** IP filtering happens after ngrok forwards the request to OpenTunnel's proxy server. This means the request has already reached ngrok's servers. For true origin filtering with ngrok, use their paid [IP Policies](https://ngrok.com/docs/cloud-edge/modules/ip-restrictions/) feature.

### Header Support

IP addresses are extracted from (in order):
1. `CF-Connecting-IP` (Cloudflare)
2. `X-Real-IP` (nginx, proxies)
3. `X-Forwarded-For` (standard proxy header, first IP)
4. Socket `remoteAddress` (direct connection)
