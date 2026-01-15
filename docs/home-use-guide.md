# Home Use Guide

This guide walks you through setting up OpenTunnel on your home network to expose local services to the internet.

## Overview

With OpenTunnel you can:
- Access your home services from anywhere
- Share development servers with collaborators
- Run your own tunnel server instead of using third-party services

## Prerequisites

- Node.js 18 or higher
- A domain name (or use free DuckDNS)
- A server with a public IP (VPS, cloud instance, or home server with port forwarding)

## Architecture Options

### Option 1: Use Your Own VPS as Tunnel Server

```
Internet -> Your VPS (tunnel server) -> Your Home (tunnel client) -> Local Services
```

### Option 2: Self-Hosted at Home (Requires Port Forwarding)

```
Internet -> Your Router -> Home Server (tunnel server + services)
```

## Step-by-Step Setup

### Step 1: Install OpenTunnel

```bash
npm install -g opentunnel-cli
```

### Step 2: Choose Your Setup

#### Option A: VPS as Tunnel Server

**On your VPS:**

```bash
# Create configuration
cat > opentunnel.yml << 'EOF'
server:
  domain: tunnel.yourdomain.com
  token: your-secret-token-here
EOF

# Start the server
opentunnel server --letsencrypt --email your@email.com
```

**On your home computer:**

```bash
# Expose a local service
opentunnel http 3000 -s tunnel.yourdomain.com -t your-secret-token-here
```

#### Option B: Self-Hosted at Home

**Configure your router to forward these ports:**

| Port | Protocol | Purpose |
|------|----------|---------|
| 443 | TCP | HTTPS tunnel connections |
| 80 | TCP | HTTP to HTTPS redirect (optional) |
| 10000-20000 | TCP | TCP tunnel ports (optional) |

**On your home server:**

```bash
opentunnel server --domain yourdomain.com --letsencrypt --email your@email.com
```

### Step 3: Expose Your Services

#### Expose a Web Application

```bash
# Your app running on localhost:3000
opentunnel http 3000 -s tunnel.yourdomain.com -t your-token

# Access at: https://random-name.op.tunnel.yourdomain.com
```

#### Expose with Custom Subdomain

```bash
opentunnel http 3000 -s tunnel.yourdomain.com -t your-token -n myapp

# Access at: https://myapp.op.tunnel.yourdomain.com
```

#### Expose SSH or Other TCP Services

```bash
opentunnel tcp 22 -s tunnel.yourdomain.com -t your-token

# Connect via: ssh user@tunnel.yourdomain.com -p 10001
```

### Step 4: Secure Your Setup

#### Use Authentication Tokens

```yaml
server:
  domain: tunnel.yourdomain.com
  token: ${AUTH_TOKEN}  # Set in environment
```

#### Restrict IP Access

```yaml
server:
  domain: tunnel.yourdomain.com
  ipAccess:
    mode: allowlist
    allowList:
      - 192.168.1.0/24  # Your home network
      - YOUR.PUBLIC.IP  # Your work IP
```

#### Enable Dymo API Protection

```yaml
server:
  domain: tunnel.yourdomain.com
  dymo:
    apiKey: ${DYMO_API_KEY}
    blockBots: true
```

## Common Home Services to Expose

### Home Assistant

```bash
opentunnel http 8123 -s tunnel.yourdomain.com -n homeassistant
```

### Plex Media Server

```bash
opentunnel http 32400 -s tunnel.yourdomain.com -n plex
```

### Minecraft Server

```bash
opentunnel tcp 25565 -s tunnel.yourdomain.com
```

### Development Server

```bash
# React/Vue/Next.js dev server
opentunnel http 3000 -s tunnel.yourdomain.com -n dev
```

### Git Server (Gitea/GitLab)

```bash
opentunnel http 3000 -s tunnel.yourdomain.com -n git
opentunnel tcp 22 -s tunnel.yourdomain.com  # For SSH access
```

## Running as a Service

### Using systemd (Linux)

Create `/etc/systemd/system/opentunnel.service`:

```ini
[Unit]
Description=OpenTunnel Server
After=network.target

[Service]
Type=simple
User=opentunnel
WorkingDirectory=/home/opentunnel
ExecStart=/usr/bin/opentunnel server
Restart=always
RestartSec=10
Environment=AUTH_TOKEN=your-secret-token

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl enable opentunnel
sudo systemctl start opentunnel
```

### Using PM2

```bash
pm2 start "opentunnel server" --name tunnel-server
pm2 save
pm2 startup
```

### Background Mode

```bash
opentunnel server -d  # Run in background

opentunnel stop       # Stop background server
opentunnel logs       # View logs
```

## Firewall Configuration

### UFW (Ubuntu)

```bash
sudo ufw allow 443/tcp
sudo ufw allow 80/tcp
sudo ufw allow 10000:20000/tcp
```

### firewalld (CentOS/Fedora)

```bash
sudo firewall-cmd --permanent --add-port=443/tcp
sudo firewall-cmd --permanent --add-port=80/tcp
sudo firewall-cmd --permanent --add-port=10000-20000/tcp
sudo firewall-cmd --reload
```

### iptables

```bash
iptables -A INPUT -p tcp --dport 443 -j ACCEPT
iptables -A INPUT -p tcp --dport 80 -j ACCEPT
iptables -A INPUT -p tcp --dport 10000:20000 -j ACCEPT
```

## Troubleshooting

### Connection Refused

1. Check if the server is running: `opentunnel logs`
2. Verify ports are open: `netstat -tlnp | grep opentunnel`
3. Check firewall rules

### SSL Certificate Issues

- Ensure ports 80 and 443 are accessible from the internet
- Check Let's Encrypt rate limits
- For development, use `--no-https` or self-signed certificates

### Can't Connect from Client

1. Verify the domain resolves: `nslookup tunnel.yourdomain.com`
2. Check if HTTPS is working: `curl https://tunnel.yourdomain.com`
3. Verify the token matches between server and client

## Performance Tips

1. **Use a nearby VPS**: Choose a VPS region close to you for lower latency
2. **Enable compression**: Many web frameworks support gzip automatically
3. **Use TCP tunnels for games**: HTTP adds overhead; use TCP for real-time applications
