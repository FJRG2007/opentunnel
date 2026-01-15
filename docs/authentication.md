# Authentication

OpenTunnel uses a **shared secret** system. The server defines valid tokens, and clients must provide one to connect.

## Server Setup

### CLI

```bash
# Single token
opentunnel server -d --domain example.com --auth-tokens "my-secret-token"

# Multiple tokens
opentunnel server -d --domain example.com --auth-tokens "team-a,team-b,dev"
```

### Configuration File

```yaml
server:
  domain: example.com
  token: my-secret-token
```

### Environment Variable

```env
AUTH_TOKENS=team-a-token,team-b-token,dev-token
```

## Client Usage

### CLI

```bash
opentunnel quick 3000 -s example.com -t my-secret-token
```

### Configuration File

```yaml
server:
  remote: example.com
  token: my-secret-token
```

### Environment Variable

```yaml
server:
  remote: example.com
  token: ${AUTH_TOKEN}
```

## Security Recommendations

1. **Use strong tokens**: Generate random strings
   ```bash
   openssl rand -hex 32
   ```

2. **One token per user/team**: Easier to revoke access

3. **HTTPS only**: Always use `--letsencrypt` in production

4. **Rotate tokens periodically**: Update and notify users

5. **Never commit tokens**: Use environment variables

## Public vs Private Server

| Mode | Configuration | Client Requirement |
|------|--------------|-------------------|
| Public | No `--auth-tokens` | None |
| Private | `--auth-tokens "token1,token2"` | Must provide valid token |

## See Also

- [Server Guide](server-guide.md)
- [Configuration](configuration.md)
