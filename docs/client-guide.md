# Client Guide

Use OpenTunnel to expose your local services to the internet. Connect to any OpenTunnel server (your own or one shared with you).

## Installation

```bash
# NPM (recommended)
npm install -g opentunnel-cli

# Or use without installing
npx opentunnel-cli quick 3000 -s example.com
```

## Quick Start Methods

### Method 1: Expose Local (expl)

The fastest way to expose a port with your own domain:

```bash
# Set your default domain (one time only)
opentunnel setdomain yourdomain.com

# Then expose any port
opentunnel expl 3000
```

This starts a local server and exposes your port. Requires your domain to point to your machine.

### Method 2: Quick Command

Connect to an existing OpenTunnel server:

```bash
# Connect to a remote server
opentunnel quick 3000 -s example.com

# Or start your own local server
opentunnel quick 3000 -s yourdomain.com --local-server
```

**Options:**
```bash
opentunnel quick 3000 -s example.com                    # Basic HTTP tunnel
opentunnel quick 3000 -s example.com -n myapp           # Custom subdomain
opentunnel quick 5432 -s example.com -p tcp             # TCP tunnel
opentunnel quick 3000 -s example.com -t SECRET          # With auth token
opentunnel quick 3000 -s example.com --insecure         # Self-signed cert
opentunnel quick 3000 -s example.com -b ""              # No basePath
opentunnel quick 3000 -s yourdomain.com --local-server  # Hybrid mode
```

### Method 3: HTTP/TCP Commands

More control with specific commands:

```bash
# HTTP tunnel
opentunnel http 3000 -s example.com
opentunnel http 3000 --domain example.com --subdomain myapp

# With authentication
opentunnel http 3000 -s example.com -t SECRET

# TCP tunnel
opentunnel tcp 5432 -s example.com -r 15432
```

### Method 4: Configuration File

Create `opentunnel.yml`:

```yaml
server:
  remote: example.com
  token: ${AUTH_TOKEN}

tunnels:
  - name: web
    protocol: http
    port: 3000
    subdomain: myapp

  - name: api
    protocol: http
    port: 4000
    subdomain: api

  - name: postgres
    protocol: tcp
    port: 5432
    remotePort: 15432
```

```bash
opentunnel up         # Start all tunnels
opentunnel up -d      # Start in background
opentunnel down       # Stop all tunnels
opentunnel ps         # Check status
```

## Output Example

```
  Status:    ● Online
  Local:     localhost:3000
  Public:    https://myapp.op.example.com
```

## Common Options

| Option | Description |
|--------|-------------|
| `-s, --domain` | Server domain |
| `-n, --subdomain` | Custom subdomain name |
| `-t, --token` | Authentication token |
| `-p, --protocol` | http, https, or tcp |
| `-b, --base-path` | Server base path (default: op) |
| `--insecure` | Skip SSL verification |
| `--local-server` | Start local server (hybrid mode) |

## See Also

- [Commands Reference](commands.md)
- [Configuration File](configuration.md)
- [Home Use Guide](home-use-guide.md)
