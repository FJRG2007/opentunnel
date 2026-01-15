# Firewall with Dymo API

OpenTunnel supports optional integration with [Dymo API](https://dymo.dev) for advanced fraud detection and bot protection. This feature verifies incoming connections by checking IP addresses and user agents against Dymo's database.

## Features

- **IP Fraud Detection**: Block IPs flagged as fraudulent or malicious
- **Bot Detection**: Automatically block bot user agents (enabled by default)
- **Proxy/VPN Detection**: Optionally block connections from proxies and VPNs
- **Hosting/Datacenter Detection**: Optionally block connections from cloud providers

## Setup

### 1. Get a Dymo API Key

1. Sign up at [Dymo](https://tpe.li/new-api-key)
2. Create a new API key in your dashboard
3. Copy the API key for use in OpenTunnel

### 2. Configure OpenTunnel

#### Via CLI

```bash
opentunnel server --domain example.com --dymo-api-key YOUR_API_KEY
```

#### Via Configuration File (opentunnel.yml)

```yaml
server:
  domain: example.com
  dymo:
    apiKey: ${DYMO_API_KEY}  # Use environment variable
    blockBots: true          # Block bot user agents (default: true)
    blockProxies: false      # Block proxy/VPN IPs (default: false)
    blockHosting: false      # Block hosting/datacenter IPs (default: false)
    cacheResults: true       # Cache results to reduce API calls (default: true)
    cacheTTL: 300            # Cache TTL in seconds (default: 300 = 5 minutes)
```

## Configuration Options

| Option | CLI Flag | Default | Description |
|--------|----------|---------|-------------|
| `apiKey` | `--dymo-api-key <key>` | - | Your Dymo API key (required to enable) |
| `blockBots` | `--no-dymo-block-bots` | `true` | Block bot user agents |
| `blockProxies` | `--dymo-block-proxies` | `false` | Block proxy/VPN connections |
| `blockHosting` | `--dymo-block-hosting` | `false` | Block datacenter/hosting IPs |
| `cacheResults` | `--no-dymo-cache` | `true` | Cache verification results |
| `cacheTTL` | `--dymo-cache-ttl <sec>` | `300` | Cache TTL in seconds |

## API Call Optimization (Caching)

By default, OpenTunnel caches Dymo API verification results to reduce API calls and avoid rate limiting. When a user visits a page:

1. **First request**: Calls Dymo API to verify IP + User Agent
2. **Subsequent requests**: Uses cached result (CSS, JS, images, etc.)

The cache key is based on the combination of IP address and User Agent, so different users get separate verifications.

### Cache Settings

```yaml
server:
  dymo:
    apiKey: ${DYMO_API_KEY}
    cacheResults: true    # Enable caching (default)
    cacheTTL: 300         # 5 minutes cache (default)
```

### Disable Caching

If you need to verify every single request (not recommended due to rate limits):

```bash
opentunnel server --domain example.com --dymo-api-key KEY --no-dymo-cache
```

Or in config:

```yaml
server:
  dymo:
    apiKey: ${DYMO_API_KEY}
    cacheResults: false
```

## Usage Examples

### Basic Setup (Block Bots Only)

```bash
opentunnel server --domain example.com --dymo-api-key YOUR_KEY
```

This will:
- Verify all incoming IP addresses
- Block IPs flagged as fraud
- Block bot user agents (default behavior)

### Allow Bots

```bash
opentunnel server --domain example.com --dymo-api-key YOUR_KEY --no-dymo-block-bots
```

### Block Everything (Maximum Security)

```bash
opentunnel server --domain example.com \
  --dymo-api-key YOUR_KEY \
  --dymo-block-proxies \
  --dymo-block-hosting
```

This will block:
- Fraudulent IPs
- Bot user agents
- Proxy/VPN connections
- Datacenter/hosting provider IPs

### Configuration File Example

```yaml
name: secure-server

server:
  domain: ${DOMAIN}
  token: ${AUTH_TOKEN}
  dymo:
    apiKey: ${DYMO_API_KEY}
    blockBots: true
    blockProxies: true
    blockHosting: false
```

## How It Works

1. When a client connects to the tunnel server, OpenTunnel extracts:
   - Client IP address (from socket or `X-Forwarded-For` header)
   - User-Agent header

2. These are sent to Dymo API for verification in a single request

3. Dymo API returns fraud scores and detection flags

4. Based on your configuration, the connection is either:
   - **Allowed**: Client proceeds with authentication
   - **Denied**: Connection closed with code 1008 (Policy Violation)

## Fail-Open Behavior

If Dymo API is unavailable or returns an error, connections are **allowed** by default (fail-open). This ensures your tunnel service remains operational even if Dymo API has issues.

## Combining with IP Access Control

Dymo API can be used alongside OpenTunnel's built-in IP access control:

```yaml
server:
  domain: example.com
  ipAccess:
    mode: allowlist
    allowList:
      - 192.168.1.0/24
      - 10.0.0.0/8
  dymo:
    apiKey: ${DYMO_API_KEY}
```

The order of checks is:
1. IP allowlist/denylist (fast, local check)
2. Dymo API verification (if configured)
3. Authentication (if required)

## Logs

When Dymo API blocks a connection, you'll see logs like:

```
[Server] Connection denied by Dymo API for IP 1.2.3.4: IP flagged as fraud by Dymo API
[Server] Connection denied by Dymo API for IP 5.6.7.8: Bot user agent detected by Dymo API
```
