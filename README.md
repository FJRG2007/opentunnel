# OpenTunnel

Self-hosted alternative to ngrok. Expose local services to the internet with custom subdomains.

## Installation

### NPM (Recommended)

```bash
# Linux / macOS
sudo npm install -g opentunnel-cli --force

# Windows (run as Administrator)
npm install -g opentunnel-cli --force

# Verify installation
opentunnel --version
```

### NPX (No installation required)

```bash
npx opentunnel-cli up
```

### From Source

```bash
git clone https://github.com/FJRG2007/opentunnel.git
cd opentunnel
npm install
npm run build

# Linux / macOS
sudo npm link

# Windows (run as Administrator)
npm link
```

### Update

```bash
# Linux / macOS
sudo npm update -g opentunnel-cli

# Windows
npm update -g opentunnel-cli
```

---

## Usage

### Main commands

```bash
opentunnel up      # Start server and tunnels
opentunnel down    # Stop everything
opentunnel init    # Create opentunnel.yml config file
```

---

## Deployment Types

### 1. On a VPS/Server

Typical production use. The server runs on a VPS with a public IP and configured domain.

**Requirements:**
- VPS with public IP
- Domain pointing to the VPS (e.g., `*.op.yourdomain.com`)
- Port 443 open

**DNS Configuration:**
```
Type    Name    Content/Value     Proxy status (Cloudflare only)
 A      *.op    <VPS_IP_ADDRESS>  DNS only
 A      op      <VPS_IP_ADDRESS>  DNS only
```

**opentunnel.yml on the VPS:**
```yaml
version: "1.0"

server:
  port: 443
  domain: yourdomain.com
  basePath: op

tunnels: []  # VPS only runs the server
```

**On your local machine:**
```yaml
version: "1.0"

server:
  url: wss://op.yourdomain.com/_tunnel  # Connect to VPS

tunnels:
  - name: web
    protocol: http
    port: 3000
    subdomain: web
```

```bash
# On the VPS
opentunnel up

# On your local machine
opentunnel up
```

Result: `https://web.op.yourdomain.com` -> `localhost:3000`

---

### 2. At Home (Domestic Use)

Run the server on your own local network. Requires router configuration.

**Requirements:**
- Domain pointing to your public IP (can be dynamic with DuckDNS)
- Configure port forwarding on your router

**DNS Configuration:**
```
Type    Name    Content/Value       Proxy status (Cloudflare only)
 A      *.op    <YOUR_PUBLIC_IP>    DNS only
 A      op      <YOUR_PUBLIC_IP>    DNS only
```

If you have a dynamic IP, use DuckDNS:
```
Type    Name    Content/Value
 A      *.op    yoursubdomain.duckdns.org (auto-updated)
 A      op      yoursubdomain.duckdns.org (auto-updated)
```

**Router Configuration (Port Forwarding):**

| Name | Protocol | WAN Port | LAN Port | LAN IP |
|------|----------|----------|----------|--------|
| OpenTunnel HTTPS | TCP | 443 | 443 | 192.168.1.X |
| OpenTunnel TCP | TCP | 10000-20000 | 10000-20000 | 192.168.1.X |

> Replace `192.168.1.X` with your machine's local IP address.

**opentunnel.yml:**
```yaml
version: "1.0"

server:
  port: 443
  domain: yourdomain.com  # or yoursubdomain.duckdns.org
  basePath: op

tunnels:
  - name: web
    protocol: http
    port: 3000
    subdomain: web
    autostart: true

  - name: api
    protocol: http
    port: 4000
    subdomain: api
    autostart: true
```

```bash
opentunnel up
```

Result:
- `https://web.op.yourdomain.com` -> `localhost:3000`
- `https://api.op.yourdomain.com` -> `localhost:4000`

---

## Full Configuration

**opentunnel.yml:**
```yaml
version: "1.0"

server:
  port: 443              # Server port (default: 443)
  domain: yourdomain.com # Base domain
  basePath: op           # Subdomain prefix (default: op)
  https: true            # Enable HTTPS (default: true)
  tcpPortMin: 10000      # Minimum TCP port (default: 10000)
  tcpPortMax: 20000      # Maximum TCP port (default: 20000)
  token: secret          # Authentication token (optional)

  # To connect to a remote server:
  # url: wss://server.com/_tunnel

tunnels:
  # HTTP Tunnel
  - name: web
    protocol: http
    port: 3000
    subdomain: web
    host: localhost      # (default: localhost)
    autostart: true      # (default: true)

  # TCP Tunnel (databases, etc.)
  - name: postgres
    protocol: tcp
    port: 5432
    remotePort: 15432    # Public TCP port
    autostart: false
```

---

## Additional Commands

```bash
# Quick HTTP tunnel (without yml file)
opentunnel http 3000 --subdomain web --domain yourdomain.com

# TCP tunnel
opentunnel tcp 5432 --remote-port 15432 --domain yourdomain.com

# Start in background
opentunnel up -d

# View status
opentunnel ps

# Stop everything
opentunnel down

# Initialize configuration file
opentunnel init
```

---

## Architecture

```
                    INTERNET
                        |
                        v
+--------------------------------------------------+
|                    ROUTER                         |
|  Port Forward: 443 -> 192.168.1.X:443            |
+--------------------------------------------------+
                        |
                        v
+--------------------------------------------------+
|             YOUR MACHINE (192.168.1.X)           |
|                                                   |
|   +-------------------------------------------+  |
|   |            OpenTunnel Server              |  |
|   |              (port 443)                   |  |
|   +-------------------------------------------+  |
|          |                    |                  |
|          v                    v                  |
|   +------------+       +------------+            |
|   | Web App    |       | API        |            |
|   | :3000      |       | :4000      |            |
|   +------------+       +------------+            |
+--------------------------------------------------+

Access from internet:
  https://web.op.yourdomain.com -> localhost:3000
  https://api.op.yourdomain.com -> localhost:4000
```

---

## SSL Certificates

OpenTunnel generates SSL certificates automatically:

- **Self-signed** (default): Works but browser shows warning
- **Let's Encrypt**: Valid certificates (requires port 80)

```bash
# Use Let's Encrypt
opentunnel server --letsencrypt --email your@email.com
```

---

## License

MIT
