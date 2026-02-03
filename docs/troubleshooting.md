# Troubleshooting

Common issues and solutions when using OpenTunnel.

## Port Conflicts

### Error: "Port X is already in use!"

**Common causes:**
- **Port 8080**: Pi-hole, other web admin panels
- **Port 80/443**: Apache, Nginx, IIS, other web servers
- **Port 3000**: Node.js development servers
- **Port 5000**: Python Flask development servers

**Solutions:**

1. **Change OpenTunnel port:**
   ```bash
   # CLI
   opentunnel server --domain example.com --port 8443

   # Config file (opentunnel.yml)
   server:
     port: 8443
   ```

2. **Check what's using the port:**

   **Linux/macOS:**
   ```bash
   lsof -i :8080
   netstat -tlnp | grep :8080
   ```

   **Windows (PowerShell):**
   ```powershell
   netstat -ano | findstr :8080
   Get-Process -Id (Get-NetTCPConnection -LocalPort 8080).OwningProcess
   ```

3. **Change Pi-hole port (if using Pi-hole on Linux):**
   ```bash
   sudo nano /etc/lighttpd/lighttpd.conf
   # Change server.port = 8080 to server.port = 8081
   sudo systemctl restart lighttpd
   ```

## Privileged Ports (80, 443)

Ports below 1024 require elevated privileges on Linux/macOS.

**Linux/macOS:**
```bash
# Option 1: Run with sudo
sudo opentunnel server -d --domain example.com --port 443

# Option 2: Use a higher port with reverse proxy
opentunnel server -d --domain example.com --port 8443
```

**Windows:**
- Run Command Prompt or PowerShell as Administrator
- Or use a higher port (8443, 8080, etc.)

## Server Stop Issues

### "No server running (PID file not found)"

**Cause:** The server was started with elevated privileges (sudo/Administrator) but you're trying to stop it without them.

**Linux/macOS:**
```bash
# If started with sudo, stop with sudo
sudo opentunnel stop
```

**Windows:**
- If started as Administrator, run command prompt as Administrator to stop

**Note:** When you start the server with `sudo`, the PID file is stored in `/root/.opentunnel/logs/server.pid`. Without sudo, it looks in `~/.opentunnel/logs/server.pid`.

## Connection Issues

### Client can't connect to server

**Symptoms:**
- "Connection refused"
- "Timeout waiting for server"
- WebSocket connection failed

**Solutions:**

1. **Check server is running:**
   ```bash
   opentunnel ps
   ```

2. **Verify server port:**
   ```bash
   # If server uses custom port
   opentunnel quick 3000 -s example.com:8443 -t TOKEN
   ```

3. **Check firewall:**

   **Linux (UFW):**
   ```bash
   sudo ufw allow 8443/tcp
   ```

   **Linux (firewalld):**
   ```bash
   sudo firewall-cmd --permanent --add-port=8443/tcp
   sudo firewall-cmd --reload
   ```

   **Windows (PowerShell as Admin):**
   ```powershell
   New-NetFirewallRule -DisplayName "OpenTunnel" -Direction Inbound -LocalPort 8443 -Protocol TCP -Action Allow
   ```

4. **Test with --insecure (for self-signed certs):**
   ```bash
   opentunnel quick 3000 -s example.com --insecure -t TOKEN
   ```

### Tunnel not accessible

**Symptoms:**
- Tunnel created but URL returns 404
- "Tunnel not found" error

**Solutions:**

1. **Check DNS configuration:**
   - Ensure `*.op.example.com` points to your server
   - Use DNS check tools: `dig myapp.op.example.com`

2. **Verify subdomain is available:**
   ```bash
   # Check active tunnels
   curl https://op.example.com/api/tunnels -H "Authorization: Bearer TOKEN"
   ```

3. **Check if tunnel client is connected:**
   ```bash
   opentunnel ps
   # Look for tunnel instances
   ```

## Authentication Issues

### Invalid token error

**Symptoms:**
- "Authentication failed"
- "Invalid token" from server

**Solutions:**

1. **Verify token matches server config:**
   ```bash
   # Server
   opentunnel server --auth-tokens "SECRET123"

   # Client must use same token
   opentunnel quick 3000 -s example.com -t SECRET123
   ```

2. **Check config file:**
   ```yaml
   # Server opentunnel.yml
   server:
     auth:
       required: true
       tokens: ["SECRET123"]

   # Client opentunnel.yml
   server:
     token: SECRET123
   ```

## SSL Certificate Issues

### Certificate errors

**Symptoms:**
- "SSL certificate has expired"
- "Self-signed certificate" warnings

**Solutions:**

1. **For development/testing:**
   ```bash
   opentunnel quick 3000 -s example.com --insecure -t TOKEN
   ```

2. **Renew Let's Encrypt certificate:**
   ```bash
   # Restart server to trigger renewal
   opentunnel stop
   opentunnel start
   ```

3. **Check certificate expiry:**
   ```bash
   openssl s_client -connect op.example.com:443 -servername op.example.com
   ```

## Performance Issues

### Slow tunnel response

**Solutions:**

1. **Check server resources:**
   ```bash
   top  # Check CPU/memory usage
   df -h  # Check disk space
   ```

2. **Monitor active tunnels:**
   ```bash
   curl https://op.example.com/api/stats
   ```

3. **Check network latency:**
   ```bash
   ping op.example.com
   traceroute op.example.com
   ```

## Log Debugging

### Enable debug logging

1. **CLI with debug:**
   ```bash
   DEBUG=opentunnel:* opentunnel server --domain example.com
   ```

2. **Check log files:**
   ```bash
   # Logs stored in ~/.opentunnel/logs/
   ls ~/.opentunnel/logs/
   cat ~/.opentunnel/logs/instance.log
   ```

3. **Server logs:**
   ```bash
   # If running as service
   sudo journalctl -u opentunnel -f
   ```

## Common Error Messages

| Error | Cause | Solution |
|-------|-------|----------|
| `Port 8080 already in use` | Another service (Pi-hole) using port | Use `--port 8443` or stop the conflicting service |
| `Authentication failed` | Wrong token | Verify token matches server configuration |
| `Tunnel not found` | No tunnel for that subdomain | Check if tunnel client is running |
| `Connection refused` | Server not running or blocked by firewall | Start server and open firewall ports |
| `SSL certificate error` | Self-signed cert or expired cert | Use `--insecure` or renew certificate |
| `DNS resolution failed` | Domain not pointing to server | Check DNS records for `*.op.example.com` |

## Getting Help

1. **Check logs:** Always check logs for detailed error messages
2. **Test locally:** Test with `--local-server` first
3. **Use simple configs:** Start with minimal configuration, then add complexity
4. **Check network:** Verify connectivity between client and server

## Advanced Troubleshooting

### Manual Connection Test

```bash
# Test WebSocket connection directly
wscat -c wss://op.example.com/_tunnel

# Test HTTP endpoint
curl https://op.example.com/api/status

# Test with custom headers
curl -H "Host: test.op.example.com" https://op.example.com
```

### Monitor Network Traffic

```bash
# Monitor WebSocket traffic
tcpdump -i any port 443

# Monitor DNS queries
tcpdump -i any port 53

# Check active connections
ss -tuln | grep :443
```