# Cloudflare Tunnel Integration

OpenTunnel supports Cloudflare Tunnel as an alternative to the built-in server or ngrok.

## Automatic Installation

**cloudflared is installed automatically** when you first use Cloudflare Tunnel. No manual installation required.

```bash
# First run will download cloudflared automatically
opentunnel http 3000 --cf
```

## Quick Tunnels (Free, No Account Required)

Quick tunnels are the easiest way to expose a local service. They provide a random `*.trycloudflare.com` URL that changes each time.

### CLI Usage

```bash
# Expose HTTP server on port 3000
opentunnel http 3000 --cloudflare

# Short form
opentunnel http 3000 --cf

# Expose with HTTPS origin (if your local server uses HTTPS)
opentunnel http 3000 --cf --https
```

### Configuration File (opentunnel.yml)

```yaml
provider: cloudflare

tunnels:
  - name: web
    protocol: http
    port: 3000

  - name: api
    protocol: http
    port: 4000
```

Start with:
```bash
opentunnel up
```

Each tunnel gets its own unique `*.trycloudflare.com` URL.

## Named Tunnels (Persistent URLs)

Named tunnels require a Cloudflare account and a domain in Cloudflare. They provide persistent URLs that don't change.

### 1. Login to Cloudflare

```bash
opentunnel login cloudflare
```

Opens a browser for Cloudflare OAuth authentication. Credentials are stored at `~/.opentunnel/credentials.json`.

### 2. Configure Named Tunnels

Named tunnels **require** `cfHostname` - a domain you own that's managed by Cloudflare:

```yaml
provider: cloudflare

tunnels:
  - name: web
    protocol: http
    port: 3000
    subdomain: web-tunnel          # Tunnel name (auto-created if doesn't exist)
    cfHostname: web.example.com    # REQUIRED: Your domain in Cloudflare

  - name: api
    protocol: http
    port: 4000
    subdomain: api-tunnel
    cfHostname: api.example.com
```

**Important:**
- `subdomain`: The name of the Cloudflare tunnel (will be auto-created if it doesn't exist)
- `cfHostname`: Your domain managed by Cloudflare DNS (REQUIRED for named tunnels)

### 3. Run

```bash
opentunnel up
```

OpenTunnel will:
1. Auto-create the tunnel if it doesn't exist
2. Auto-configure DNS routing
3. Start the tunnel

### Manual Tunnel Management

```bash
# Create a tunnel manually
opentunnel create my-tunnel --cf

# List your tunnels
opentunnel tunnels --cf

# Route DNS manually
opentunnel route my-tunnel myapp.example.com

# Delete a tunnel
opentunnel delete my-tunnel --cf
```

## Quick vs Named Tunnels

| Feature | Quick Tunnels | Named Tunnels |
|---------|---------------|---------------|
| URL | Random `*.trycloudflare.com` | Your domain (`app.example.com`) |
| Persistence | Changes each run | Persistent |
| Account required | No | Yes |
| Domain required | No | Yes (in Cloudflare) |
| Setup | None | Login + configure cfHostname |

## Mixed Providers

Use different providers for different tunnels:

```yaml
# Default provider
provider: cloudflare

tunnels:
  # Uses Cloudflare quick tunnel
  - name: public
    protocol: http
    port: 3000

  # Uses ngrok
  - name: dev
    protocol: http
    port: 4000
    provider: ngrok

  # Uses OpenTunnel server
  - name: internal
    protocol: http
    port: 5000
    provider: opentunnel
```

## IP Filtering

Apply IP filtering to Cloudflare tunnels:

```yaml
provider: cloudflare

tunnels:
  - name: admin
    protocol: http
    port: 5000
    ipAccess:
      mode: allowlist
      allowList:
        - 192.168.0.0/16
        - 10.0.0.0/8
```

## Programmatic Usage

```typescript
import { CloudflareTunnelClient } from "opentunnel";

// Quick tunnel (random URL)
const client = new CloudflareTunnelClient({
    protocol: "http",
});

await client.connect();
const { publicUrl } = await client.createTunnel({
    protocol: "http",
    localHost: "localhost",
    localPort: 3000,
});
console.log(`Tunnel: ${publicUrl}`);

// Named tunnel
const namedClient = new CloudflareTunnelClient({
    tunnelName: "my-tunnel",
    hostname: "myapp.example.com",
});

await namedClient.connect();
const result = await namedClient.createTunnel({
    protocol: "http",
    localHost: "localhost",
    localPort: 3000,
});

// Static methods
await CloudflareTunnelClient.createNamedTunnel("new-tunnel");
await CloudflareTunnelClient.routeDns("new-tunnel", "app.example.com");
await CloudflareTunnelClient.deleteTunnel("old-tunnel");
const tunnels = await CloudflareTunnelClient.listTunnels();
```

## Troubleshooting

### "Named tunnel requires cfHostname"

Named tunnels need a domain configured in Cloudflare. Either:
- Add `cfHostname: yourdomain.com` to your config
- Remove `subdomain` to use a quick tunnel with random URL

### "Not logged in to Cloudflare"

Run `opentunnel login cloudflare` first.

### "Timeout waiting for Cloudflare Tunnel URL"

1. Check your internet connection
2. Check firewall settings - cloudflared needs outbound HTTPS
3. Try again - first connection may take longer

### Manual Installation (if automatic fails)

```bash
# Windows
winget install cloudflare.cloudflared

# macOS
brew install cloudflared

# Ubuntu/Debian
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o cloudflared.deb
sudo dpkg -i cloudflared.deb
```

## See Also

- [Cloudflare Tunnel Documentation](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
- [Commands Reference](commands.md)
- [Configuration Guide](configuration.md)
