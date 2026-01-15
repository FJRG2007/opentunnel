# Multi-Domain Support

OpenTunnel can handle **multiple domains** on a single server. Each domain works independently.

## DNS Configuration

For each domain, create DNS records:

| Domain | Type | Name | Value |
|--------|------|------|-------|
| `domain1.com` | A | `op` | `YOUR_SERVER_IP` |
| `domain1.com` | A | `*.op` | `YOUR_SERVER_IP` |
| `domain2.com` | A | `op` | `YOUR_SERVER_IP` |
| `domain2.com` | A | `*.op` | `YOUR_SERVER_IP` |

## Server Configuration

```yaml
server:
  domains:
    - domain: domain1.com
      basePath: op
    - domain: domain2.com
      basePath: op
  port: 443
```

```bash
opentunnel server -d
```

## Client Connections

Clients connect to any configured domain:

```bash
# Client A → domain1.com
opentunnel quick 3000 -s domain1.com -n myapp
# → https://myapp.op.domain1.com

# Client B → domain2.com
opentunnel quick 8080 -s domain2.com -n api
# → https://api.op.domain2.com
```

## Single Domain (Default)

For one domain:

```yaml
server:
  domain: example.com
  basePath: op
```

## Non-Wildcard Domains (DuckDNS)

Domains without wildcard support use **port-based routing**:

```yaml
server:
  domains:
    - domain: fjrg2007.com
      basePath: op              # → *.op.fjrg2007.com
    - domain: myapp.duckdns.org
                                # → myapp.duckdns.org:<port>
```

**Important:** DuckDNS domains cannot use `basePath`.

Manual configuration for other non-wildcard domains:

```yaml
server:
  domains:
    - domain: other.com
      wildcard: false           # Port-based routing
```

**Routing comparison:**
- Wildcard: `https://myapp.op.fjrg2007.com`
- Non-wildcard: `https://myapp.duckdns.org:10001`

## SSL Certificates

Self-signed certificates automatically generate a **SAN certificate** covering all domains.

For Let's Encrypt, use multi-domain certificates or separate certificates per domain.

## Use Cases

### Different Teams

```yaml
server:
  domains:
    - domain: dev.company.com
      basePath: op
    - domain: staging.company.com
      basePath: op
```

### White-Label Service

```yaml
server:
  domains:
    - domain: client1.com
      basePath: op
    - domain: client2.com
      basePath: op
```

## See Also

- [Domain Setup](domain-setup.md)
- [DuckDNS Setup](duckdns-setup.md)
