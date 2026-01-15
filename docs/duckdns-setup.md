# DuckDNS and Free DNS Setup

This guide covers setting up OpenTunnel with free dynamic DNS services like DuckDNS, No-IP, and similar providers. These are ideal for home users with dynamic IP addresses.

## Why Use Free DNS?

- **Free**: No cost for basic usage
- **Dynamic IP support**: Automatically updates when your IP changes
- **No domain purchase required**: Get a subdomain instantly
- **Perfect for home use**: Ideal for personal projects and home labs

## Supported Free DNS Services

| Service | Domain Format | Wildcard Support |
|---------|---------------|------------------|
| DuckDNS | yourname.duckdns.org | No |
| No-IP | yourname.ddns.net | No |
| Dynu | yourname.dynu.net | Limited |
| FreeDNS | yourname.afraid.org | No |

## DuckDNS Setup

### Step 1: Create a DuckDNS Account

1. Go to [duckdns.org](https://www.duckdns.org)
2. Sign in with Google, GitHub, Twitter, or Reddit
3. Create a subdomain (e.g., `mytunnel`)
4. Copy your token from the dashboard

### Step 2: Configure OpenTunnel

**Important**: DuckDNS doesn't support wildcard subdomains. OpenTunnel automatically uses **port-based routing** instead:

```
https://mytunnel.duckdns.org:10001  -> Tunnel 1
https://mytunnel.duckdns.org:10002  -> Tunnel 2
```

#### Via CLI

```bash
opentunnel server --domain mytunnel.duckdns.org --duckdns-token YOUR_TOKEN
```

#### Via Configuration File

```yaml
# opentunnel.yml
server:
  domain: mytunnel.duckdns.org
  # basePath is automatically disabled for DuckDNS domains

autoDns:
  enabled: true
  provider: duckdns
  duckdnsToken: ${DUCKDNS_TOKEN}
```

### Step 3: Port Forwarding

Forward these ports on your router:

| Port | Purpose |
|------|---------|
| 443 | Main server / WebSocket connections |
| 10000-20000 | TCP tunnel ports (adjust range as needed) |

### Step 4: Start the Server

```bash
# Set your token as environment variable
export DUCKDNS_TOKEN=your-token-here

# Start the server
opentunnel server
```

### Step 5: Connect a Client

```bash
opentunnel http 3000 -s mytunnel.duckdns.org --insecure

# Output: tcp://mytunnel.duckdns.org:10001
```

## No-IP Setup

### Step 1: Create Account

1. Go to [noip.com](https://www.noip.com)
2. Create a free account
3. Create a hostname (e.g., `mytunnel.ddns.net`)
4. Install the No-IP DUC (Dynamic Update Client) or use their API

### Step 2: Configure OpenTunnel

```yaml
server:
  domain: mytunnel.ddns.net
```

```bash
opentunnel server --domain mytunnel.ddns.net
```

### Step 3: Keep IP Updated

Run the No-IP client to keep your IP updated:

```bash
# On Linux
noip2 -c /etc/no-ip2.conf
```

## Dynu Setup

### Step 1: Create Account

1. Go to [dynu.com](https://www.dynu.com)
2. Create a free account
3. Add a DDNS service
4. Get your username and password

### Step 2: Configure OpenTunnel

```yaml
server:
  domain: mytunnel.dynu.net
```

### Step 3: Update IP

Use Dynu's IP update URL or their client software.

## Understanding Port-Based Routing

Since free DNS services don't support wildcard subdomains, OpenTunnel uses ports instead:

### With Normal Domain (Wildcard Support)

```
https://app1.op.example.com -> Tunnel 1
https://app2.op.example.com -> Tunnel 2
https://app3.op.example.com -> Tunnel 3
```

### With DuckDNS (Port-Based)

```
https://mytunnel.duckdns.org:10001 -> Tunnel 1
https://mytunnel.duckdns.org:10002 -> Tunnel 2
https://mytunnel.duckdns.org:10003 -> Tunnel 3
```

## SSL Certificates with DuckDNS

### Self-Signed (Default)

OpenTunnel generates a self-signed certificate automatically:

```bash
opentunnel server --domain mytunnel.duckdns.org
```

Clients need `--insecure` flag:

```bash
opentunnel http 3000 -s mytunnel.duckdns.org --insecure
```

### Let's Encrypt

Let's Encrypt works with DuckDNS but requires HTTP-01 challenge:

```bash
opentunnel server --domain mytunnel.duckdns.org \
  --letsencrypt \
  --email your@email.com
```

**Requirements**:
- Port 80 must be accessible from the internet
- Domain must point to your server

## Complete DuckDNS Example

### Server Setup

```yaml
# opentunnel.yml
name: home-tunnel

server:
  domain: myhome.duckdns.org
  token: ${AUTH_TOKEN}
  tcpPortMin: 10000
  tcpPortMax: 10100
```

```bash
# Environment variables
export DUCKDNS_TOKEN=abc123...
export AUTH_TOKEN=my-secret-token

# Start server
opentunnel server
```

### Client Connection

```bash
# Expose web app
opentunnel http 8080 -s myhome.duckdns.org -t my-secret-token --insecure
# -> https://myhome.duckdns.org:10001

# Expose SSH
opentunnel tcp 22 -s myhome.duckdns.org -t my-secret-token
# -> tcp://myhome.duckdns.org:10002

# Expose game server
opentunnel tcp 25565 -s myhome.duckdns.org -t my-secret-token
# -> tcp://myhome.duckdns.org:10003
```

## Automatic IP Updates

### DuckDNS Update Script

Create a cron job to update your IP:

```bash
# /usr/local/bin/duckdns-update.sh
#!/bin/bash
echo url="https://www.duckdns.org/update?domains=mytunnel&token=YOUR_TOKEN&ip=" | curl -k -o /dev/null -K -
```

Add to crontab:

```bash
*/5 * * * * /usr/local/bin/duckdns-update.sh
```

### With OpenTunnel Auto-DNS

OpenTunnel can update DuckDNS automatically:

```yaml
server:
  domain: mytunnel.duckdns.org

autoDns:
  enabled: true
  provider: duckdns
  duckdnsToken: ${DUCKDNS_TOKEN}
```

## Comparison: DuckDNS vs Own Domain

| Feature | DuckDNS | Own Domain |
|---------|---------|------------|
| Cost | Free | ~$10-15/year |
| Wildcard subdomains | No | Yes |
| Custom domain name | No | Yes |
| Routing method | Port-based | Subdomain-based |
| SSL certificates | Self-signed or HTTP-01 | All methods |
| Professional look | No | Yes |
| Reliability | Good | Depends on registrar |

## Troubleshooting

### IP Not Updating

1. Check DuckDNS dashboard for last update time
2. Verify token is correct
3. Test update URL manually:
   ```bash
   curl "https://www.duckdns.org/update?domains=mytunnel&token=TOKEN&ip="
   ```

### Cannot Connect

1. Verify domain resolves to your IP: `nslookup mytunnel.duckdns.org`
2. Check if ports are forwarded correctly
3. Test local connection first: `curl -k https://localhost:443`

### SSL Certificate Errors

For development, use `--insecure` on the client:

```bash
opentunnel http 3000 -s mytunnel.duckdns.org --insecure
```

For production, set up Let's Encrypt with HTTP-01 challenge.

## Tips for Home Users

1. **Use a static internal IP**: Set a static IP for your server on your router
2. **Document your ports**: Keep a list of which port goes to which service
3. **Enable authentication**: Always use `--auth-tokens` for security
4. **Backup your token**: Keep your DuckDNS token safe
5. **Monitor your IP**: Set up alerts if your IP changes unexpectedly
