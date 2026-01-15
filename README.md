<h1 align="center">OpenTunnel</h1>

<p align="center">Self-hosted alternative to ngrok. Expose local services to the internet with custom subdomains.</p>

---

## Quick Start

### Installation

```bash
npm install -g opentunnel-cli
```

### As a Client

Connect to an existing OpenTunnel server:

```bash
# Quick tunnel
opentunnel quick 3000 -s example.com

# With authentication
opentunnel quick 3000 -s example.com -t YOUR_TOKEN

# Custom subdomain
opentunnel quick 3000 -s example.com -n myapp
# → https://myapp.op.example.com
```

### As a Server

Host your own tunnel server:

```bash
# Public server
opentunnel server -d --domain example.com --letsencrypt --email admin@example.com

# Private server (with auth)
opentunnel server -d --domain example.com --letsencrypt --email admin@example.com --auth-tokens "SECRET"
```

**DNS Setup:** Point `op.example.com` and `*.op.example.com` to your server IP.

### Home Use (Hybrid Mode)

Run server + tunnel in one terminal:

```bash
# Set default domain (one time)
opentunnel setdomain yourdomain.com

# Expose any port
opentunnel expl 3000
```

---

## Documentation

| Guide | Description |
|-------|-------------|
| [Client Guide](docs/client-guide.md) | Complete client usage and options |
| [Server Guide](docs/server-guide.md) | Server deployment and configuration |
| [Commands Reference](docs/commands.md) | All CLI commands and options |
| [Configuration File](docs/configuration.md) | opentunnel.yml reference |
| [Home Use Guide](docs/home-use-guide.md) | Running from home with port forwarding |
| [Domain Setup](docs/domain-setup.md) | DNS and SSL configuration |
| [DuckDNS & Free DNS](docs/duckdns-setup.md) | Free DNS services setup |
| [Multi-Domain](docs/multi-domain.md) | Multiple domains on one server |
| [Authentication](docs/authentication.md) | Token-based authentication |
| [IP Access Control](docs/ip-access-control.md) | Allow/deny IP ranges |
| [Firewall (Dymo API)](docs/firewall-dymo-api.md) | Fraud detection and bot protection |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         INTERNET                                │
│   Users access: https://myapp.op.example.com                   │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                    OpenTunnel Server                            │
│                    (op.example.com)                             │
│   - Routes by subdomain                                         │
│   - Forwards via WebSocket                                      │
└──────────────────────────────┬──────────────────────────────────┘
                               │ WebSocket
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Your Computer                              │
│                  (behind NAT/firewall)                          │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│   │  Web App     │  │  API Server  │  │  Database    │         │
│   │  :3000       │  │  :4000       │  │  :5432       │         │
│   └──────────────┘  └──────────────┘  └──────────────┘         │
└─────────────────────────────────────────────────────────────────┘
```

---

## License

[Proprietary License](LICENSE) - All rights reserved.

- ✅ Personal, educational, and commercial use allowed
- ❌ No forks or redistribution without permission
- ❌ No reselling without explicit consent

Contact FJRG2007 for licensing questions.
