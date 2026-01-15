# Domain Setup Guide

This guide explains how to configure a regular domain (e.g., from Cloudflare, Namecheap, GoDaddy) to work with OpenTunnel.

## How OpenTunnel Uses Domains

OpenTunnel uses a subdomain pattern for routing:

```
https://{tunnel-name}.{base-path}.{your-domain}
```

For example, with domain `example.com` and base path `op`:
- Main server: `https://op.example.com`
- Tunnel: `https://myapp.op.example.com`

## DNS Configuration

### Step 1: Point Your Domain to Your Server

Add an A record pointing to your server's IP address:

| Type | Name | Value | TTL |
|------|------|-------|-----|
| A | op | YOUR.SERVER.IP | 3600 |

### Step 2: Add Wildcard Record

For automatic tunnel subdomains, add a wildcard record:

| Type | Name | Value | TTL |
|------|------|-------|-----|
| A | *.op | YOUR.SERVER.IP | 3600 |

### Step 3: (Optional) Add Root Domain

If you want the root domain to also point to your server:

| Type | Name | Value | TTL |
|------|------|-------|-----|
| A | @ | YOUR.SERVER.IP | 3600 |

## Provider-Specific Instructions

### Cloudflare

1. Go to your domain's DNS settings
2. Add the following records:

```
Type: A
Name: op
IPv4 address: YOUR.SERVER.IP
Proxy status: DNS only (gray cloud) or Proxied (orange cloud)

Type: A
Name: *.op
IPv4 address: YOUR.SERVER.IP
Proxy status: DNS only (recommended for WebSocket)
```

**Note**: For WebSocket tunnels, disable Cloudflare proxy (gray cloud) or ensure WebSocket is enabled in your Cloudflare settings.

### Namecheap

1. Go to Domain List > Manage > Advanced DNS
2. Add Host Records:

```
Type: A Record
Host: op
Value: YOUR.SERVER.IP
TTL: Automatic

Type: A Record
Host: *.op
Value: YOUR.SERVER.IP
TTL: Automatic
```

### GoDaddy

1. Go to My Products > DNS > Manage
2. Add Records:

```
Type: A
Name: op
Value: YOUR.SERVER.IP
TTL: 1 Hour

Type: A
Name: *.op
Value: YOUR.SERVER.IP
TTL: 1 Hour
```

### Google Domains

1. Go to DNS > Custom records
2. Add:

```
Host name: op
Type: A
TTL: 3600
Data: YOUR.SERVER.IP

Host name: *.op
Type: A
TTL: 3600
Data: YOUR.SERVER.IP
```

## SSL Certificates

### Option 1: Let's Encrypt (Recommended)

Automatically obtain free SSL certificates:

```bash
opentunnel server --domain example.com --letsencrypt --email your@email.com
```

For wildcard certificates (covers all subdomains), you need DNS-01 challenge. With Cloudflare:

```bash
opentunnel server --domain example.com \
  --letsencrypt \
  --email your@email.com \
  --cloudflare-token YOUR_CLOUDFLARE_API_TOKEN
```

### Option 2: Self-Signed (Development)

```bash
opentunnel server --domain example.com
# Self-signed certificate is generated automatically
```

Clients need to use `--insecure` flag to connect.

### Option 3: Custom Certificate

```bash
opentunnel server --domain example.com \
  --https-cert /path/to/cert.pem \
  --https-key /path/to/key.pem
```

## Configuration Examples

### Basic Setup

```yaml
# opentunnel.yml
server:
  domain: example.com
```

```bash
opentunnel server --letsencrypt --email admin@example.com
```

### Custom Base Path

Change the base path from `op` to something else:

```yaml
server:
  domain: example.com
  basePath: tunnel  # Now: https://myapp.tunnel.example.com
```

### Multiple Domains

Serve multiple domains from one server:

```yaml
server:
  domains:
    - domain: example.com
      basePath: op
    - domain: example.org
      basePath: tunnel
```

### With Authentication

```yaml
server:
  domain: example.com
  token: ${AUTH_TOKEN}
```

## Verifying DNS Configuration

### Check DNS Propagation

```bash
# Check if A record is set
nslookup op.example.com

# Check wildcard
nslookup test.op.example.com

# Or use dig
dig op.example.com A
dig test.op.example.com A
```

### Test HTTPS Connection

```bash
curl -v https://op.example.com
```

## Troubleshooting

### DNS Not Resolving

1. Wait for DNS propagation (can take up to 48 hours, usually minutes)
2. Check if records are correct in your DNS provider
3. Try flushing local DNS cache:
   - Windows: `ipconfig /flushdns`
   - macOS: `sudo dscacheutil -flushcache`
   - Linux: `sudo systemd-resolve --flush-caches`

### SSL Certificate Errors

1. Ensure ports 80 and 443 are open
2. Check Let's Encrypt rate limits (5 certificates per week per domain)
3. Verify domain points to the correct server
4. Check server logs: `opentunnel logs`

### Wildcard Not Working

1. Some DNS providers require specific wildcard syntax
2. Ensure the wildcard record points to the same IP as the base record
3. Cloudflare users: disable proxy for wildcard records if having issues

## Best Practices

1. **Use environment variables for tokens**: Never hardcode secrets in config files
2. **Enable authentication**: Use `--auth-tokens` for production servers
3. **Use HTTPS**: Always use Let's Encrypt or custom certificates in production
4. **Monitor DNS**: Set up monitoring to detect DNS issues
5. **Keep TTL low initially**: Use low TTL (300-600) during setup, increase later
