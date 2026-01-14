import http, { IncomingMessage, ServerResponse } from "http";
import https from "https";
import net from "net";
import tls from "tls";
import { WebSocket, WebSocketServer } from "ws";
import { EventEmitter } from "events";
import {
    ServerConfig,
    TunnelConfig,
    TunnelInfo,
    Message,
    HttpRequestMessage,
    HttpResponseMessage,
    TcpDataMessage,
    TunnelRequestMessage,
    AuthMessage,
    DnsProvider,
    IpAccessConfig,
} from "../shared/types";
import {
    generateId,
    generateSubdomain,
    encodeMessage,
    decodeMessage,
    encodeBase64,
    decodeBase64,
    extractSubdomain,
    getNextAvailablePort,
    Logger,
} from "../shared/utils";
import { CertManager } from "./CertManager";
import { CloudflareDNS } from "../dns/CloudflareDNS";
import { DuckDNS } from "../dns/DuckDNS";

interface Client {
    id: string;
    ws: WebSocket;
    authenticated: boolean;
    tunnels: Map<string, Tunnel>;
    createdAt: Date;
    lastPong: number;
    isAlive: boolean;
}

interface Tunnel {
    id: string;
    config: TunnelConfig;
    client: Client;
    publicUrl: string;
    tcpServer?: net.Server;
    tcpConnections: Map<string, net.Socket>;
    stats: {
        bytesIn: number;
        bytesOut: number;
        connections: number;
    };
    createdAt: Date;
}

interface PendingRequest {
    resolve: (response: HttpResponseMessage) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
}

export class TunnelServer extends EventEmitter {
    private config: ServerConfig;
    private httpServer: http.Server | https.Server;
    private httpRedirectServer: http.Server | null = null;
    private wss: WebSocketServer;
    private clients: Map<string, Client> = new Map();
    private tunnelsBySubdomain: Map<string, Tunnel> = new Map();
    private tunnelsByPort: Map<number, Tunnel> = new Map();
    private usedPorts: Set<number> = new Set();
    private pendingRequests: Map<string, PendingRequest> = new Map();
    private logger: Logger;
    private keepaliveInterval: NodeJS.Timeout | null = null;
    private certManager: CertManager | null = null;
    private isHttps: boolean = false;
    private dnsProvider: CloudflareDNS | DuckDNS | null = null;

    constructor(config: Partial<ServerConfig>) {
        super();
        this.config = {
            port: 8080,
            host: "0.0.0.0",
            domain: "localhost",
            basePath: "op",
            tunnelPortRange: { min: 10000, max: 20000 },
            ...config,
        };
        this.logger = new Logger("Server");

        // Create HTTP server initially (will be upgraded to HTTPS if needed)
        this.httpServer = http.createServer();

        // Setup request handler
        this.httpServer.on("request", this.handleHttpRequest.bind(this));

        // Create WebSocket server
        this.wss = new WebSocketServer({ noServer: true });

        // Handle upgrade requests
        this.httpServer.on("upgrade", (request, socket, head) => {
            const url = new URL(request.url || "/", `http://${request.headers.host}`);

            if (url.pathname === "/_tunnel") {
                this.wss.handleUpgrade(request, socket, head, (ws) => {
                    this.handleConnection(ws, request);
                });
            } else {
                socket.destroy();
            }
        });
    }

    // Check if an IP matches a CIDR range or single IP
    private ipMatchesCidr(ip: string, cidr: string): boolean {
        // Normalize IPv6-mapped IPv4 addresses
        const normalizedIp = ip.replace(/^::ffff:/, "");
        const normalizedCidr = cidr.replace(/^::ffff:/, "");

        // If it's a single IP (no /), do direct comparison
        if (!normalizedCidr.includes("/")) {
            return normalizedIp === normalizedCidr;
        }

        const [range, bits] = normalizedCidr.split("/");
        const mask = parseInt(bits, 10);

        // Convert IP addresses to numbers for comparison
        const ipParts = normalizedIp.split(".").map(Number);
        const rangeParts = range.split(".").map(Number);

        if (ipParts.length !== 4 || rangeParts.length !== 4) {
            // Not valid IPv4, try simple string match
            return normalizedIp === range;
        }

        const ipNum = (ipParts[0] << 24) | (ipParts[1] << 16) | (ipParts[2] << 8) | ipParts[3];
        const rangeNum = (rangeParts[0] << 24) | (rangeParts[1] << 16) | (rangeParts[2] << 8) | rangeParts[3];
        const maskNum = ~((1 << (32 - mask)) - 1);

        return (ipNum & maskNum) === (rangeNum & maskNum);
    }

    // Check if an IP is in a list (supports CIDR notation)
    private ipInList(ip: string, list: string[]): boolean {
        return list.some(entry => this.ipMatchesCidr(ip, entry));
    }

    // Check if an IP is allowed based on the access config
    private isIpAllowed(ip: string): { allowed: boolean; reason?: string } {
        const config = this.config.ipAccess;

        // Default: allow all
        if (!config || config.mode === "all") {
            return { allowed: true };
        }

        // Normalize IP
        const normalizedIp = ip.replace(/^::ffff:/, "");

        if (config.mode === "allowlist") {
            // Only allow IPs in the allowList
            if (config.allowList && this.ipInList(normalizedIp, config.allowList)) {
                return { allowed: true };
            }
            return { allowed: false, reason: `IP ${normalizedIp} not in allowlist` };
        }

        if (config.mode === "denylist") {
            // Deny IPs in the denyList, allow others
            if (config.denyList && this.ipInList(normalizedIp, config.denyList)) {
                return { allowed: false, reason: `IP ${normalizedIp} is in denylist` };
            }
            return { allowed: true };
        }

        return { allowed: true };
    }

    private async setupHttps(): Promise<void> {
        if (this.config.https) {
            // Manual HTTPS with provided certificates
            this.logger.info("Setting up HTTPS with provided certificates");
            this.httpServer = https.createServer({
                cert: this.config.https.cert,
                key: this.config.https.key,
            });
            this.isHttps = true;
        } else if (this.config.selfSignedHttps?.enabled) {
            // Self-signed certificates (local/development)
            this.logger.info("Setting up HTTPS with self-signed certificate");

            this.certManager = new CertManager({
                certsDir: this.config.selfSignedHttps.certsDir,
            });

            // Generate self-signed certificate for the domain
            const domain = `${this.config.basePath}.${this.config.domain}`;
            const certInfo = this.certManager.getOrCreateSelfSignedCert(domain);

            this.httpServer = https.createServer({
                cert: certInfo.cert,
                key: certInfo.key,
            });

            this.isHttps = true;
            this.logger.info(`Self-signed certificate valid until: ${certInfo.expiresAt.toISOString()}`);
            this.logger.warn("⚠️  Using self-signed certificate - browsers will show security warning");
        } else if (this.config.autoHttps?.enabled) {
            // Automatic HTTPS with Let's Encrypt
            this.logger.info("Setting up automatic HTTPS with Let's Encrypt");

            this.certManager = new CertManager({
                certsDir: this.config.autoHttps.certsDir,
                email: this.config.autoHttps.email,
                production: this.config.autoHttps.production,
                cloudflareToken: this.config.autoHttps.cloudflareToken,
            });

            await this.certManager.initialize();

            // Determine domains to get certificate for
            const wildcardDomain = `*.${this.config.basePath}.${this.config.domain}`;
            const hasCloudflare = this.certManager.hasCloudflare();

            // With Cloudflare, we can get wildcard certificates via DNS-01
            // Without Cloudflare, we can only get single-domain certs via HTTP-01
            const domains = hasCloudflare
                ? [this.config.domain, wildcardDomain]
                : [this.config.domain];

            // If using Cloudflare, find the zone first
            if (hasCloudflare) {
                const zoneId = await this.certManager.findCloudflareZone(this.config.domain);
                if (!zoneId) {
                    throw new Error(`Could not find Cloudflare zone for domain: ${this.config.domain}`);
                }
            }

            // Check for existing certificate
            let certInfo = await this.certManager.getCertificate(domains);

            if (!certInfo) {
                this.logger.info(`Requesting SSL certificate for: ${domains.join(", ")}`);

                // For HTTP-01 challenges (non-wildcard), start challenge server
                if (!hasCloudflare) {
                    const challengeServer = this.certManager.createChallengeServer();
                    await new Promise<void>((resolve) => {
                        challengeServer.listen(80, "0.0.0.0", () => {
                            this.logger.info("ACME challenge server started on port 80");
                            resolve();
                        });
                    });

                    try {
                        certInfo = await this.certManager.requestCertificate(domains);
                    } finally {
                        challengeServer.close();
                    }
                } else {
                    // DNS-01 challenge via Cloudflare (no HTTP server needed)
                    this.logger.info("Using DNS-01 challenge via Cloudflare for wildcard certificate");
                    certInfo = await this.certManager.requestCertificate(domains);
                }
            }

            // Create HTTPS server with the certificate
            this.httpServer = https.createServer({
                cert: certInfo.cert,
                key: certInfo.key,
            });

            // Create HTTP redirect server
            this.httpRedirectServer = http.createServer((req, res) => {
                const host = req.headers.host || this.config.domain;

                // Handle ACME challenge
                if (req.url?.startsWith("/.well-known/acme-challenge/") && this.certManager) {
                    const token = req.url.split("/").pop() || "";
                    const keyAuth = this.certManager.handleChallengeRequest(token);
                    if (keyAuth) {
                        res.writeHead(200, { "Content-Type": "text/plain" });
                        res.end(keyAuth);
                        return;
                    }
                }

                // Redirect to HTTPS
                res.writeHead(301, { Location: `https://${host}${req.url}` });
                res.end();
            });

            this.isHttps = true;
            this.logger.info(`SSL certificate valid until: ${certInfo.expiresAt.toISOString()}`);
        }

        // Re-setup request handlers for new server
        if (this.isHttps) {
            this.httpServer.on("request", this.handleHttpRequest.bind(this));
            this.httpServer.on("upgrade", (request, socket, head) => {
                const url = new URL(request.url || "/", `https://${request.headers.host}`);
                if (url.pathname === "/_tunnel") {
                    this.wss.handleUpgrade(request, socket, head, (ws) => {
                        this.handleConnection(ws, request);
                    });
                } else {
                    socket.destroy();
                }
            });
        }
    }

    async start(): Promise<void> {
        // Setup HTTPS if configured
        await this.setupHttps();

        // Setup automatic DNS if configured (disabled - manual DNS configuration preferred)
        // await this.setupAutoDns();

        return new Promise((resolve) => {
            const port = this.isHttps ? (this.config.port === 8080 ? 443 : this.config.port) : this.config.port;

            this.httpServer.listen(port, this.config.host, () => {
                const protocol = this.isHttps ? "https" : "http";
                this.logger.info(`Server started on ${this.config.host}:${port} (${protocol.toUpperCase()})`);
                this.logger.info(`Domain: ${this.config.domain}`);
                this.logger.info(`Subdomain pattern: *.${this.config.basePath}.${this.config.domain}`);

                if (this.isHttps) {
                    this.logger.info(`SSL: Enabled (Let's Encrypt)`);
                }

                if (this.dnsProvider) {
                    this.logger.info(`DNS: Automatic management enabled (${this.dnsProvider.name})`);
                }

                // Start HTTP redirect server if using HTTPS
                if (this.httpRedirectServer) {
                    this.httpRedirectServer.listen(80, this.config.host, () => {
                        this.logger.info("HTTP→HTTPS redirect server on port 80");
                    });
                }

                // Start keepalive interval to ping clients and detect dead connections
                this.startKeepalive();

                resolve();
            });
        });
    }

    private async setupAutoDns(): Promise<void> {
        if (!this.config.autoDns?.enabled) {
            return;
        }

        const provider = this.detectDnsProvider();

        if (provider === "cloudflare" && this.config.autoDns.cloudflareToken) {
            this.logger.info("Auto-detected DNS provider: Cloudflare");
            this.logger.info("Setting up automatic DNS management...");

            const cfProvider = new CloudflareDNS(
                this.config.autoDns.cloudflareToken,
                this.config.domain,
                this.config.basePath
            );

            const initialized = await cfProvider.initialize();
            if (!initialized) {
                this.logger.error("Failed to initialize Cloudflare DNS - automatic DNS disabled");
                return;
            }

            this.dnsProvider = cfProvider;

            // Setup wildcard and base records if requested
            if (this.config.autoDns.setupWildcard !== false) {
                const success = await cfProvider.setupDNS();
                if (success) {
                    this.logger.info("DNS records configured successfully");
                } else {
                    this.logger.warn("Some DNS records could not be configured");
                }
            }
        } else if (provider === "duckdns" && this.config.autoDns.duckdnsToken) {
            this.logger.info("Auto-detected DNS provider: DuckDNS");

            const duckProvider = new DuckDNS(this.config.autoDns.duckdnsToken);
            this.dnsProvider = duckProvider;

            // Update DuckDNS with server's public IP
            const publicIP = await duckProvider.getPublicIP();
            const duckdnsDomain = this.config.domain.replace(".duckdns.org", "");

            const success = await duckProvider.updateRecord(duckdnsDomain, publicIP);
            if (success) {
                this.logger.info(`DuckDNS updated: ${this.config.domain} -> ${publicIP}`);
            } else {
                this.logger.warn("Failed to update DuckDNS record");
            }

            this.logger.info("Note: DuckDNS uses wildcard DNS - all subdomains will resolve automatically");
        } else {
            this.logger.warn("No DNS provider configured or token missing");
            this.logger.info("Provide --cloudflare-token or --duckdns-token for automatic DNS");
        }
    }

    private detectDnsProvider(): "cloudflare" | "duckdns" | null {
        // Explicit provider setting takes priority
        if (this.config.autoDns?.provider) {
            return this.config.autoDns.provider;
        }

        // Auto-detect based on tokens
        if (this.config.autoDns?.cloudflareToken) {
            return "cloudflare";
        }

        if (this.config.autoDns?.duckdnsToken) {
            return "duckdns";
        }

        // Auto-detect based on domain
        if (this.config.domain.endsWith(".duckdns.org")) {
            return "duckdns";
        }

        return null;
    }

    stop(): Promise<void> {
        return new Promise((resolve) => {
            // Stop keepalive
            this.stopKeepalive();

            // Close all tunnels
            for (const client of this.clients.values()) {
                for (const tunnel of client.tunnels.values()) {
                    this.closeTunnel(tunnel);
                }
                client.ws.close();
            }

            // Close HTTP redirect server if exists
            if (this.httpRedirectServer) {
                this.httpRedirectServer.close();
            }

            this.wss.close(() => {
                this.httpServer.close(() => {
                    this.logger.info("Server stopped");
                    resolve();
                });
            });
        });
    }

    private startKeepalive(): void {
        // Ping all clients every 20 seconds
        this.keepaliveInterval = setInterval(() => {
            for (const client of this.clients.values()) {
                if (!client.isAlive) {
                    // Client didn't respond to last ping, terminate
                    this.logger.warn(`Client ${client.id} not responding, terminating`);
                    client.ws.terminate();
                    continue;
                }

                // Mark as not alive, will be set back to true when pong received
                client.isAlive = false;

                // Send WebSocket-level ping
                if (client.ws.readyState === WebSocket.OPEN) {
                    client.ws.ping();
                }
            }
        }, 20000);
    }

    private stopKeepalive(): void {
        if (this.keepaliveInterval) {
            clearInterval(this.keepaliveInterval);
            this.keepaliveInterval = null;
        }
    }

    private handleConnection(ws: WebSocket, request: IncomingMessage): void {
        // Get client IP from request
        const clientIp = request.socket.remoteAddress ||
                        request.headers["x-forwarded-for"]?.toString().split(",")[0].trim() ||
                        "unknown";

        // Check IP access control
        const ipCheck = this.isIpAllowed(clientIp);
        if (!ipCheck.allowed) {
            this.logger.warn(`Connection denied for IP ${clientIp}: ${ipCheck.reason}`);
            ws.close(1008, "Access denied"); // 1008 = Policy Violation
            return;
        }

        const clientId = generateId();
        const client: Client = {
            id: clientId,
            ws,
            authenticated: !this.config.auth?.required,
            tunnels: new Map(),
            createdAt: new Date(),
            lastPong: Date.now(),
            isAlive: true,
        };

        this.clients.set(clientId, client);
        this.logger.info(`Client connected: ${clientId} (IP: ${clientIp})`);

        // Handle WebSocket-level pong (response to our ping)
        ws.on("pong", () => {
            client.isAlive = true;
            client.lastPong = Date.now();
        });

        ws.on("message", (data: Buffer) => {
            // Any message counts as activity
            client.isAlive = true;
            client.lastPong = Date.now();

            try {
                const message = decodeMessage(data.toString());
                this.handleMessage(client, message);
            } catch (err) {
                this.logger.error(`Failed to parse message from ${clientId}`);
            }
        });

        ws.on("close", () => {
            this.logger.info(`Client disconnected: ${clientId}`);
            // Close all tunnels for this client
            for (const tunnel of client.tunnels.values()) {
                this.closeTunnel(tunnel);
            }
            this.clients.delete(clientId);
        });

        ws.on("error", (err) => {
            this.logger.error(`Client error ${clientId}:`, err.message);
        });

        // Send auth response if no auth required
        if (!this.config.auth?.required) {
            this.send(ws, {
                type: "auth_response",
                id: generateId(),
                timestamp: Date.now(),
                success: true,
                clientId,
            });
        }
    }

    private handleMessage(client: Client, message: Message): void {
        switch (message.type) {
            case "auth":
                this.handleAuth(client, message as AuthMessage);
                break;
            case "tunnel_request":
                this.handleTunnelRequest(client, message as TunnelRequestMessage);
                break;
            case "tunnel_close":
                this.handleTunnelClose(client, message.id);
                break;
            case "http_response":
                this.handleHttpResponse(message as HttpResponseMessage);
                break;
            case "tcp_data":
                this.handleTcpData(message as TcpDataMessage);
                break;
            case "ping":
                this.send(client.ws, { type: "pong", id: message.id, timestamp: Date.now() });
                break;
        }
    }

    private handleAuth(client: Client, message: AuthMessage): void {
        let success = false;

        if (this.config.auth?.required) {
            if (message.token && this.config.auth.tokens.includes(message.token)) {
                success = true;
                client.authenticated = true;
            }
        } else {
            success = true;
            client.authenticated = true;
        }

        this.send(client.ws, {
            type: "auth_response",
            id: generateId(),
            timestamp: Date.now(),
            success,
            clientId: success ? client.id : undefined,
            error: success ? undefined : "Invalid token",
        });
    }

    private handleTunnelRequest(client: Client, message: TunnelRequestMessage): void {
        if (!client.authenticated) {
            this.send(client.ws, {
                type: "tunnel_response",
                id: generateId(),
                timestamp: Date.now(),
                success: false,
                error: "Not authenticated",
            });
            return;
        }

        const config = message.config;
        const tunnelId = generateId();
        let publicUrl: string;

        if (config.protocol === "http" || config.protocol === "https") {
            // HTTP tunnel - use subdomain pattern: subdomain.op.domain.com
            const subdomain = config.subdomain || generateSubdomain();

            if (this.tunnelsBySubdomain.has(subdomain)) {
                this.send(client.ws, {
                    type: "tunnel_response",
                    id: generateId(),
                    timestamp: Date.now(),
                    success: false,
                    error: `Subdomain '${subdomain}' is already in use`,
                });
                return;
            }

            const protocol = this.isHttps ? "https" : "http";
            // Third-level subdomain pattern: myapp.op.domain.com
            publicUrl = `${protocol}://${subdomain}.${this.config.basePath}.${this.config.domain}`;

            // Add port to URL only if not default (80 for http, 443 for https)
            const publicPort = this.config.publicPort || this.config.port;
            const isDefaultPort = (protocol === "http" && publicPort === 80) ||
                                  (protocol === "https" && publicPort === 443);
            if (!isDefaultPort) {
                publicUrl += `:${publicPort}`;
            }

            const tunnel: Tunnel = {
                id: tunnelId,
                config: { ...config, id: tunnelId, subdomain },
                client,
                publicUrl,
                tcpConnections: new Map(),
                stats: { bytesIn: 0, bytesOut: 0, connections: 0 },
                createdAt: new Date(),
            };

            this.tunnelsBySubdomain.set(subdomain, tunnel);
            client.tunnels.set(tunnelId, tunnel);

            this.logger.info(`HTTP tunnel: ${subdomain}.${this.config.basePath}.${this.config.domain} -> ${config.localHost}:${config.localPort}`);

            // Create DNS record if auto DNS is enabled (Cloudflare only)
            if (this.dnsProvider &&
                this.config.autoDns?.createRecords !== false &&
                this.dnsProvider instanceof CloudflareDNS) {
                this.dnsProvider.updateRecord(subdomain).then((success) => {
                    if (success) {
                        this.logger.info(`DNS record created for ${subdomain}`);
                    }
                }).catch((err) => {
                    this.logger.warn(`Failed to create DNS record: ${err.message}`);
                });
            }

        } else if (config.protocol === "tcp") {
            // TCP tunnel - allocate a port
            // Priority: 1. Explicit remotePort, 2. Same as localPort (if available), 3. Next available
            let port: number | null = null;

            if (config.remotePort) {
                // User explicitly requested this port
                if (this.usedPorts.has(config.remotePort)) {
                    this.send(client.ws, {
                        type: "tunnel_response",
                        id: generateId(),
                        timestamp: Date.now(),
                        success: false,
                        error: `Port ${config.remotePort} is already in use`,
                    });
                    return;
                }
                port = config.remotePort;
            } else {
                // Try to use the same port as local (if within range and available)
                const localPort = config.localPort;
                const isInRange = localPort >= this.config.tunnelPortRange.min &&
                                  localPort <= this.config.tunnelPortRange.max;

                if (isInRange && !this.usedPorts.has(localPort)) {
                    port = localPort;
                } else {
                    // Fallback to next available port
                    port = getNextAvailablePort(
                        this.config.tunnelPortRange.min,
                        this.config.tunnelPortRange.max,
                        this.usedPorts
                    );
                }
            }

            if (!port) {
                this.send(client.ws, {
                    type: "tunnel_response",
                    id: generateId(),
                    timestamp: Date.now(),
                    success: false,
                    error: "No available ports",
                });
                return;
            }

            publicUrl = `tcp://${this.config.domain}:${port}`;

            const tunnel: Tunnel = {
                id: tunnelId,
                config: { ...config, id: tunnelId, remotePort: port },
                client,
                publicUrl,
                tcpConnections: new Map(),
                stats: { bytesIn: 0, bytesOut: 0, connections: 0 },
                createdAt: new Date(),
            };

            // Create TCP server for this tunnel
            const tcpServer = net.createServer((socket) => {
                this.handleTcpConnection(tunnel, socket);
            });

            tcpServer.listen(port, this.config.host, () => {
                this.logger.info(`TCP tunnel on port ${port} -> ${config.localHost}:${config.localPort}`);
            });

            tunnel.tcpServer = tcpServer;
            this.usedPorts.add(port);
            this.tunnelsByPort.set(port, tunnel);
            client.tunnels.set(tunnelId, tunnel);

        } else {
            this.send(client.ws, {
                type: "tunnel_response",
                id: generateId(),
                timestamp: Date.now(),
                success: false,
                error: `Unsupported protocol: ${config.protocol}`,
            });
            return;
        }

        this.send(client.ws, {
            type: "tunnel_response",
            id: generateId(),
            timestamp: Date.now(),
            success: true,
            tunnelId,
            publicUrl,
        });

        this.emit("tunnel:created", { tunnelId, publicUrl, config });
    }

    private handleTunnelClose(client: Client, tunnelId: string): void {
        const tunnel = client.tunnels.get(tunnelId);
        if (tunnel) {
            this.closeTunnel(tunnel);
        }
    }

    private closeTunnel(tunnel: Tunnel): void {
        // Close TCP server if exists
        if (tunnel.tcpServer) {
            tunnel.tcpServer.close();
            const port = tunnel.config.remotePort!;
            this.usedPorts.delete(port);
            this.tunnelsByPort.delete(port);
        }

        // Close all TCP connections
        for (const socket of tunnel.tcpConnections.values()) {
            socket.destroy();
        }

        // Remove from subdomain map and delete DNS record
        if (tunnel.config.subdomain) {
            this.tunnelsBySubdomain.delete(tunnel.config.subdomain);

            // Delete DNS record if auto DNS is enabled and deleteOnClose is true (Cloudflare only)
            if (this.dnsProvider &&
                this.config.autoDns?.deleteOnClose &&
                this.dnsProvider instanceof CloudflareDNS) {
                this.dnsProvider.deleteRecord(tunnel.config.subdomain).then((success) => {
                    if (success) {
                        this.logger.info(`DNS record deleted for ${tunnel.config.subdomain}`);
                    }
                }).catch((err) => {
                    this.logger.warn(`Failed to delete DNS record: ${err.message}`);
                });
            }
        }

        // Remove from client
        tunnel.client.tunnels.delete(tunnel.id);

        this.logger.info(`Tunnel closed: ${tunnel.id}`);
        this.emit("tunnel:closed", { tunnelId: tunnel.id });
    }

    private async handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
        const host = req.headers.host || "";
        const hostWithoutPort = host.split(":")[0];

        // Check if this is a direct request to the server (API or status)
        if (hostWithoutPort === this.config.domain ||
            hostWithoutPort === `${this.config.basePath}.${this.config.domain}`) {
            if (req.url?.startsWith("/api/")) {
                this.handleApiRequest(req, res);
                return;
            }

            // Serve status page
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
                name: "OpenTunnel Server",
                version: "1.0.0",
                status: "running",
                domain: this.config.domain,
                subdomainPattern: `*.${this.config.basePath}.${this.config.domain}`,
                tunnels: this.getTunnelCount(),
                clients: this.clients.size,
            }));
            return;
        }

        // Find tunnel by subdomain (pattern: subdomain.op.domain.com)
        const subdomain = extractSubdomain(hostWithoutPort, this.config.domain, this.config.basePath);
        if (!subdomain) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Tunnel not found" }));
            return;
        }

        const tunnel = this.tunnelsBySubdomain.get(subdomain);
        if (!tunnel) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: `Tunnel '${subdomain}' not found` }));
            return;
        }

        // Forward request to client
        const requestId = generateId();
        const bodyChunks: Buffer[] = [];

        req.on("data", (chunk) => bodyChunks.push(chunk));
        req.on("end", async () => {
            const body = Buffer.concat(bodyChunks).toString();

            const httpRequest: HttpRequestMessage = {
                type: "http_request",
                id: generateId(),
                timestamp: Date.now(),
                tunnelId: tunnel.id,
                requestId,
                method: req.method || "GET",
                path: req.url || "/",
                headers: req.headers as Record<string, string | string[] | undefined>,
                body: body || undefined,
            };

            tunnel.stats.bytesIn += body.length;
            tunnel.stats.connections++;

            try {
                const response = await this.waitForResponse(tunnel, requestId, httpRequest);

                res.writeHead(response.statusCode, response.headers as http.OutgoingHttpHeaders);
                if (response.body) {
                    // Decode base64 if the response body is encoded (for binary data like gzip)
                    const bodyBuffer = response.isBase64
                        ? Buffer.from(response.body, "base64")
                        : Buffer.from(response.body, "utf-8");
                    tunnel.stats.bytesOut += bodyBuffer.length;
                    res.end(bodyBuffer);
                } else {
                    res.end();
                }
            } catch (err) {
                res.writeHead(502, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Bad gateway - tunnel client not responding" }));
            }
        });
    }

    private waitForResponse(
        tunnel: Tunnel,
        requestId: string,
        request: HttpRequestMessage
    ): Promise<HttpResponseMessage> {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pendingRequests.delete(requestId);
                reject(new Error("Request timeout"));
            }, 30000);

            this.pendingRequests.set(requestId, { resolve, reject, timeout });
            this.send(tunnel.client.ws, request);
        });
    }

    private handleHttpResponse(message: HttpResponseMessage): void {
        const pending = this.pendingRequests.get(message.requestId);
        if (pending) {
            clearTimeout(pending.timeout);
            this.pendingRequests.delete(message.requestId);
            pending.resolve(message);
        }
    }

    private handleTcpConnection(tunnel: Tunnel, socket: net.Socket): void {
        const connectionId = generateId();
        tunnel.tcpConnections.set(connectionId, socket);
        tunnel.stats.connections++;

        this.logger.info(`TCP connection ${connectionId} to tunnel ${tunnel.id}`);

        socket.on("data", (data) => {
            tunnel.stats.bytesIn += data.length;
            this.send(tunnel.client.ws, {
                type: "tcp_data",
                id: generateId(),
                timestamp: Date.now(),
                tunnelId: tunnel.id,
                connectionId,
                data: encodeBase64(data),
            });
        });

        socket.on("close", () => {
            tunnel.tcpConnections.delete(connectionId);
            this.send(tunnel.client.ws, {
                type: "tcp_close",
                id: generateId(),
                timestamp: Date.now(),
                tunnelId: tunnel.id,
                connectionId,
            });
        });

        socket.on("error", (err) => {
            this.logger.error(`TCP connection error: ${err.message}`);
        });
    }

    private handleTcpData(message: TcpDataMessage): void {
        // Find tunnel and connection
        for (const client of this.clients.values()) {
            const tunnel = client.tunnels.get(message.tunnelId);
            if (tunnel) {
                const socket = tunnel.tcpConnections.get(message.connectionId);
                if (socket) {
                    const data = decodeBase64(message.data);
                    tunnel.stats.bytesOut += data.length;
                    socket.write(data);
                }
                break;
            }
        }
    }

    private handleApiRequest(req: IncomingMessage, res: ServerResponse): void {
        const url = new URL(req.url || "/", `http://${req.headers.host}`);

        res.setHeader("Content-Type", "application/json");

        if (url.pathname === "/api/tunnels" && req.method === "GET") {
            const tunnels = this.getAllTunnels();
            res.writeHead(200);
            res.end(JSON.stringify({ tunnels }));
        } else if (url.pathname === "/api/stats" && req.method === "GET") {
            res.writeHead(200);
            res.end(JSON.stringify({
                clients: this.clients.size,
                tunnels: this.getTunnelCount(),
                uptime: process.uptime(),
            }));
        } else {
            res.writeHead(404);
            res.end(JSON.stringify({ error: "Not found" }));
        }
    }

    private send(ws: WebSocket, message: Message): void {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(encodeMessage(message));
        }
    }

    private getTunnelCount(): number {
        let count = 0;
        for (const client of this.clients.values()) {
            count += client.tunnels.size;
        }
        return count;
    }

    private getAllTunnels(): TunnelInfo[] {
        const tunnels: TunnelInfo[] = [];
        for (const client of this.clients.values()) {
            for (const tunnel of client.tunnels.values()) {
                tunnels.push({
                    id: tunnel.id,
                    protocol: tunnel.config.protocol,
                    localAddress: `${tunnel.config.localHost}:${tunnel.config.localPort}`,
                    publicUrl: tunnel.publicUrl,
                    createdAt: tunnel.createdAt,
                    bytesIn: tunnel.stats.bytesIn,
                    bytesOut: tunnel.stats.bytesOut,
                    connections: tunnel.stats.connections,
                });
            }
        }
        return tunnels;
    }
}
