# Cloudflare Tunnel Integration

OpenTunnel supports Cloudflare Tunnel as an alternative to the built-in server or ngrok.

## Automatic Installation

**cloudflared is installed automatically** when you first use Cloudflare Tunnel. No manual installation required.

```bash
# First run will download cloudflared automatically
opentunnel http 3000 --cf

# Or.

opentunnel http 3000 --cloudflare
```

The binary is managed by the `cloudflared` npm package and stored in `node_modules/cloudflared/bin/`.

## Quick Tunnels (Free, No Account Required)

Quick tunnels are the easiest way to expose a local service. They provide a random `*.trycloudflare.com` URL.

### CLI Usage

```bash
# Expose HTTP server on port 3000
opentunnel http 3000 --cloudflare

# Short form
opentunnel http 3000 --cf

# Expose with HTTPS origin (if your local server uses HTTPS)
opentunnel http 3000 --cf --https

# Skip TLS verification for self-signed certs
opentunnel http 3000 --cf --insecure
```

### Quick Expose

```bash
opentunnel expose 3000 --cloudflare
opentunnel expose 8080 --cf
```

### Configuration File (opentunnel.yml)

```yaml
# Use Cloudflare for all tunnels
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

### Mixed Providers

Use Cloudflare for specific tunnels only:

```yaml
# Default: OpenTunnel server
server:
  remote: example.com
  token: ${AUTH_TOKEN}

tunnels:
  # Uses OpenTunnel server
  - name: main
    protocol: http
    port: 3000
    subdomain: app

  # Uses Cloudflare Tunnel
  - name: public-api
    protocol: http
    port: 4000
    provider: cloudflare
```

## Comparison: OpenTunnel vs ngrok vs Cloudflare

| Feature | OpenTunnel | ngrok | Cloudflare Tunnel |
|---------|------------|-------|-------------------|
| Self-hosted | Yes | No | No |
| Custom domain | Yes (own) | Paid | Yes (with account) |
| Free tier | Unlimited | Limited | Generous |
| TCP tunnels | Yes | Yes | Named tunnels only |
| Setup complexity | Medium | Easy | Easy |
| Auth required | Optional | Yes | No (quick tunnels) |

## Limitations

### Quick Tunnels
- Random URL each time (no persistent hostname)
- HTTP/HTTPS only (no TCP)
- No custom domains

### TCP Tunnels
Cloudflare Tunnel supports TCP but requires additional setup:

1. Create a named tunnel in Cloudflare dashboard
2. Configure the tunnel with a `config.yml`
3. Use `cloudflared tunnel run <name>`

For simple TCP tunneling, ngrok or OpenTunnel server are easier options:

```bash
# TCP with ngrok
opentunnel tcp 5432 --ngrok

# TCP with OpenTunnel server
opentunnel tcp 5432 -s your-server.com
```

## Named Tunnels

For persistent hostnames and custom domains, use OpenTunnel's integrated named tunnel management.

### 1. Login to Cloudflare

```bash
# Opens browser for Cloudflare OAuth authentication
opentunnel login cloudflare
```

Credentials are stored securely at `~/.opentunnel/credentials.json`.

### 2. Create a Named Tunnel

```bash
opentunnel create my-tunnel --cf
```

### 3. List Your Tunnels

```bash
opentunnel tunnels --cf
```

### 4. Route DNS

Create a CNAME record pointing to your tunnel:

```bash
opentunnel route my-tunnel myapp.example.com
```

### 5. Use the Named Tunnel

**Via CLI - use `-n` to specify the tunnel name:**
```bash
opentunnel http 3000 --cf -n my-tunnel
```

**Via Configuration File:**
```yaml
provider: cloudflare

cloudflare:
  tunnelName: my-tunnel  # Default tunnel for all

tunnels:
  - name: web
    protocol: http
    port: 3000

  - name: api
    protocol: http
    port: 4000
    subdomain: api-tunnel  # Override with different tunnel
```

### 6. Delete a Tunnel

```bash
opentunnel delete my-tunnel --cf

# Skip confirmation
opentunnel delete my-tunnel --cf --force
```

## IP Filtering with Cloudflare Tunnels

Apply IP filtering to Cloudflare tunnels for additional security:

```yaml
provider: cloudflare

cloudflare:
  tunnelName: my-tunnel

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

IP filtering is handled by OpenTunnel's proxy server before forwarding to your local app.

## Programmatic Usage

```typescript
import { CloudflareTunnelClient } from "opentunnel";

// Quick tunnel (random URL)
const quickClient = new CloudflareTunnelClient({
    protocol: "http",
});

await quickClient.connect();
const { publicUrl } = await quickClient.createTunnel({
    protocol: "http",
    localHost: "localhost",
    localPort: 3000,
});
console.log(`Quick Tunnel: ${publicUrl}`);

// Named tunnel with IP filtering
const namedClient = new CloudflareTunnelClient({
    tunnelName: "my-tunnel",
    hostname: "myapp.example.com",
    noTlsVerify: true,
    ipAccess: {
        mode: "allowlist",
        allowList: ["192.168.0.0/16"],
    },
});

await namedClient.connect();
const result = await namedClient.createTunnel({
    protocol: "http",
    localHost: "localhost",
    localPort: 3000,
});
console.log(`Named Tunnel: ${result.publicUrl}`);

// Static methods for tunnel management
const tunnels = await CloudflareTunnelClient.listTunnels();
await CloudflareTunnelClient.createNamedTunnel("new-tunnel");
await CloudflareTunnelClient.routeDns("new-tunnel", "app.example.com");
await CloudflareTunnelClient.deleteTunnel("old-tunnel");

// Cleanup
await namedClient.closeTunnel(result.tunnelId);
await namedClient.disconnect();
```

## Troubleshooting

### "Timeout waiting for Cloudflare Tunnel URL"

1. Check your internet connection
2. Check firewall settings - cloudflared needs outbound HTTPS access
3. Try again - sometimes the first connection takes longer

### "Failed to create tunnel"

1. Check if another cloudflared process is running
2. Verify internet connectivity
3. Check if Cloudflare services are available

### Manual Installation (if automatic fails)

If automatic installation fails, you can install cloudflared manually:

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
- [Client Guide](client-guide.md)
