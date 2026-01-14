import http from "http";
import https from "https";
import net from "net";
import WebSocket from "ws";
import { EventEmitter } from "events";
import {
    ClientConfig,
    TunnelConfig,
    TunnelInfo,
    Message,
    HttpRequestMessage,
    TcpDataMessage,
    TcpCloseMessage,
    TunnelResponseMessage,
    AuthResponseMessage,
} from "../shared/types";
import {
    generateId,
    encodeMessage,
    decodeMessage,
    encodeBase64,
    decodeBase64,
    sleep,
    Logger,
} from "../shared/utils";

interface ActiveTunnel {
    id: string;
    config: TunnelConfig;
    publicUrl: string;
    tcpConnections: Map<string, net.Socket>;
}

interface PendingTunnel {
    config: TunnelConfig;
    resolve: (info: { tunnelId: string; publicUrl: string }) => void;
    reject: (error: Error) => void;
}

export class TunnelClient extends EventEmitter {
    private config: ClientConfig;
    private ws: WebSocket | null = null;
    private clientId: string | null = null;
    private authenticated = false;
    private tunnels: Map<string, ActiveTunnel> = new Map();
    private pendingTunnels: Map<string, PendingTunnel> = new Map();
    private reconnectAttempts = 0;
    private logger: Logger;
    private closed = false;
    private pingInterval: NodeJS.Timeout | null = null;
    private pongTimeout: NodeJS.Timeout | null = null;
    private lastPongTime: number = Date.now();

    // Reconnection settings
    private readonly baseReconnectInterval = 1000;  // Start with 1 second
    private readonly maxReconnectInterval = 30000;  // Max 30 seconds between attempts

    constructor(config: Partial<ClientConfig>) {
        super();
        this.config = {
            serverUrl: "ws://localhost:8080/_tunnel",
            reconnect: true,
            reconnectInterval: 3000,
            silent: false,
            ...config,
        };
        this.logger = new Logger("Client", false, this.config.silent);
    }

    async connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            let connectionFailed = false;
            let resolved = false;

            try {
                this.ws = new WebSocket(this.config.serverUrl, {
                    handshakeTimeout: 10000,
                    perMessageDeflate: false,
                    rejectUnauthorized: this.config.rejectUnauthorized ?? true,
                });

                const connectionTimeout = setTimeout(() => {
                    if (!resolved) {
                        connectionFailed = true;
                        this.ws?.close();
                        reject(new Error(`Connection timeout - server not reachable at ${this.config.serverUrl}`));
                    }
                }, 10000);

                this.ws.on("open", () => {
                    clearTimeout(connectionTimeout);
                    this.reconnectAttempts = 0;
                    this.lastPongTime = Date.now();

                    // Start keepalive ping interval
                    this.startPingInterval();

                    // Send auth if token provided
                    if (this.config.token) {
                        this.send({
                            type: "auth",
                            id: generateId(),
                            timestamp: Date.now(),
                            token: this.config.token,
                        });
                    }
                });

                // Handle WebSocket-level pong
                this.ws.on("pong", () => {
                    this.lastPongTime = Date.now();
                });

                this.ws.on("message", (data: Buffer) => {
                    // Any message counts as activity
                    this.lastPongTime = Date.now();

                    try {
                        const message = decodeMessage(data.toString());
                        this.handleMessage(message, () => {
                            resolved = true;
                            clearTimeout(connectionTimeout);
                            resolve();
                        }, reject);
                    } catch (err) {
                        this.logger.error("Failed to parse message");
                    }
                });

                this.ws.on("close", () => {
                    clearTimeout(connectionTimeout);
                    this.stopPingInterval();
                    this.authenticated = false;

                    if (!resolved && !connectionFailed) {
                        reject(new Error(`Connection closed - server at ${this.config.serverUrl} closed the connection`));
                        return;
                    }

                    this.emit("disconnected");

                    if (this.config.reconnect && !this.closed && resolved) {
                        this.attemptReconnect();
                    }
                });

                this.ws.on("error", (err: Error) => {
                    clearTimeout(connectionTimeout);
                    this.stopPingInterval();
                    connectionFailed = true;
                    const errorMsg = this.getConnectionErrorMessage(err);
                    if (!resolved) {
                        reject(new Error(errorMsg));
                    }
                });
            } catch (err: any) {
                reject(new Error(`Failed to create connection: ${err.message}`));
            }
        });
    }

    private startPingInterval(): void {
        this.stopPingInterval();

        // Send ping every 15 seconds
        this.pingInterval = setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                // Check if we received pong recently (within 45 seconds)
                const timeSinceLastPong = Date.now() - this.lastPongTime;
                if (timeSinceLastPong > 45000) {
                    this.logger.warn("Server not responding to pings, reconnecting...");
                    this.ws.terminate();
                    return;
                }

                // Send WebSocket-level ping
                this.ws.ping();

                // Also send application-level ping for servers that don't support WS ping
                this.send({
                    type: "ping",
                    id: generateId(),
                    timestamp: Date.now(),
                });
            }
        }, 15000);
    }

    private stopPingInterval(): void {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
        if (this.pongTimeout) {
            clearTimeout(this.pongTimeout);
            this.pongTimeout = null;
        }
    }

    private getConnectionErrorMessage(err: Error & { code?: string }): string {
        const msg = err.message || "";
        const code = err.code || "";

        if (code === "ECONNREFUSED" || msg.includes("ECONNREFUSED")) {
            return `Connection refused - server is not running at ${this.config.serverUrl}`;
        }
        if (code === "ENOTFOUND" || msg.includes("ENOTFOUND") || msg.includes("getaddrinfo")) {
            return `Server not found - check the URL: ${this.config.serverUrl}`;
        }
        if (code === "ETIMEDOUT" || msg.includes("ETIMEDOUT")) {
            return `Connection timed out - server not reachable at ${this.config.serverUrl}`;
        }
        if (code === "ECONNRESET" || msg.includes("ECONNRESET")) {
            return `Connection reset by server at ${this.config.serverUrl}`;
        }
        if (msg.includes("Unexpected server response")) {
            return `Invalid server response - check the URL: ${this.config.serverUrl}`;
        }

        // Try to get any useful info
        const fullError = code ? `${code}: ${msg}` : msg;
        return `Connection failed: ${fullError || "Server not reachable"} (${this.config.serverUrl})`;
    }

    private async attemptReconnect(): Promise<void> {
        if (this.closed) {
            return;
        }

        this.reconnectAttempts++;

        // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s (max)
        const delay = Math.min(
            this.baseReconnectInterval * Math.pow(2, this.reconnectAttempts - 1),
            this.maxReconnectInterval
        );

        this.logger.info(`Reconnecting in ${delay / 1000}s... (attempt ${this.reconnectAttempts})`);
        this.emit("reconnecting", { attempt: this.reconnectAttempts, delay });

        await sleep(delay);

        if (this.closed) {
            return;
        }

        try {
            await this.connect();
            // Re-establish tunnels
            const tunnelsToRestore = Array.from(this.tunnels.values());
            for (const tunnel of tunnelsToRestore) {
                try {
                    await this.createTunnel(tunnel.config);
                    this.logger.info(`Tunnel restored: ${tunnel.publicUrl}`);
                } catch (err: any) {
                    this.logger.error(`Failed to restore tunnel: ${err.message}`);
                }
            }
            this.emit("reconnected", { attempts: this.reconnectAttempts });
        } catch {
            // Will retry on close event (infinite retry)
        }
    }

    async disconnect(): Promise<void> {
        this.closed = true;
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    async createTunnel(config: Omit<TunnelConfig, "id">): Promise<{ tunnelId: string; publicUrl: string }> {
        if (!this.authenticated) {
            throw new Error("Not connected or authenticated");
        }

        const tunnelConfig: TunnelConfig = {
            ...config,
            id: generateId(),
        };

        return new Promise((resolve, reject) => {
            const requestId = generateId();
            this.pendingTunnels.set(requestId, { config: tunnelConfig, resolve, reject });

            this.send({
                type: "tunnel_request",
                id: requestId,
                timestamp: Date.now(),
                config: tunnelConfig,
            });

            // Timeout
            setTimeout(() => {
                if (this.pendingTunnels.has(requestId)) {
                    this.pendingTunnels.delete(requestId);
                    reject(new Error("Tunnel request timeout"));
                }
            }, 10000);
        });
    }

    async closeTunnel(tunnelId: string): Promise<void> {
        const tunnel = this.tunnels.get(tunnelId);
        if (tunnel) {
            // Close all TCP connections
            for (const socket of tunnel.tcpConnections.values()) {
                socket.destroy();
            }
            this.tunnels.delete(tunnelId);

            this.send({
                type: "tunnel_close",
                id: generateId(),
                timestamp: Date.now(),
                tunnelId,
            });
        }
    }

    getTunnels(): ActiveTunnel[] {
        return Array.from(this.tunnels.values());
    }

    private handleMessage(message: Message, connectResolve?: (value: void) => void, connectReject?: (reason?: any) => void): void {
        switch (message.type) {
            case "auth_response":
                this.handleAuthResponse(message as AuthResponseMessage, connectResolve, connectReject);
                break;
            case "tunnel_response":
                this.handleTunnelResponse(message as TunnelResponseMessage);
                break;
            case "http_request":
                this.handleHttpRequest(message as HttpRequestMessage);
                break;
            case "tcp_data":
                this.handleTcpData(message as TcpDataMessage);
                break;
            case "tcp_close":
                this.handleTcpClose(message as TcpCloseMessage);
                break;
            case "pong":
                this.emit("pong");
                break;
        }
    }

    private handleAuthResponse(
        message: AuthResponseMessage,
        resolve?: (value: void) => void,
        reject?: (reason?: any) => void
    ): void {
        if (message.success) {
            this.authenticated = true;
            this.clientId = message.clientId || null;
            this.logger.info(`Authenticated as ${this.clientId}`);
            this.emit("connected", { clientId: this.clientId });
            resolve?.();
        } else {
            this.logger.error(`Authentication failed: ${message.error}`);
            this.emit("auth_failed", { error: message.error });
            reject?.(new Error(message.error || "Authentication failed"));
        }
    }

    private handleTunnelResponse(message: TunnelResponseMessage): void {
        // Find pending tunnel request
        for (const [requestId, pending] of this.pendingTunnels.entries()) {
            if (message.success && message.tunnelId && message.publicUrl) {
                const tunnel: ActiveTunnel = {
                    id: message.tunnelId,
                    config: pending.config,
                    publicUrl: message.publicUrl,
                    tcpConnections: new Map(),
                };
                this.tunnels.set(message.tunnelId, tunnel);
                this.pendingTunnels.delete(requestId);
                pending.resolve({ tunnelId: message.tunnelId, publicUrl: message.publicUrl });
                this.emit("tunnel:created", { tunnelId: message.tunnelId, publicUrl: message.publicUrl });
                return;
            } else {
                this.pendingTunnels.delete(requestId);
                pending.reject(new Error(message.error || "Failed to create tunnel"));
                return;
            }
        }
    }

    private async handleHttpRequest(message: HttpRequestMessage): Promise<void> {
        const tunnel = this.tunnels.get(message.tunnelId);
        if (!tunnel) return;

        const { localHost, localPort } = tunnel.config;
        const isHttps = tunnel.config.protocol === "https";

        try {
            const response = await this.forwardHttpRequest(
                localHost,
                localPort,
                message,
                isHttps
            );

            this.send({
                type: "http_response",
                id: generateId(),
                timestamp: Date.now(),
                tunnelId: message.tunnelId,
                requestId: message.requestId,
                statusCode: response.statusCode,
                headers: response.headers,
                body: response.body,
                isBase64: response.isBase64,
            });
        } catch (err: any) {
            // Check if it's a connection refused error (no app running on port)
            const isConnectionRefused = err.code === "ECONNREFUSED" ||
                                        err.message?.includes("ECONNREFUSED") ||
                                        err.message?.includes("connect ECONNREFUSED");

            if (isConnectionRefused) {
                // Return friendly HTML page
                const htmlResponse = this.generateNotRunningPage(localHost, localPort);
                this.send({
                    type: "http_response",
                    id: generateId(),
                    timestamp: Date.now(),
                    tunnelId: message.tunnelId,
                    requestId: message.requestId,
                    statusCode: 502,
                    headers: {
                        "content-type": "text/html; charset=utf-8",
                        "cache-control": "no-cache",
                    },
                    body: Buffer.from(htmlResponse).toString("base64"),
                    isBase64: true,
                });
            } else {
                this.send({
                    type: "http_response",
                    id: generateId(),
                    timestamp: Date.now(),
                    tunnelId: message.tunnelId,
                    requestId: message.requestId,
                    statusCode: 502,
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ error: err.message }),
                });
            }
        }
    }

    private generateNotRunningPage(host: string, port: number): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>No Application Running - OpenTunnel</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #fff;
        }
        .container {
            text-align: center;
            padding: 40px;
            max-width: 600px;
        }
        .icon {
            font-size: 80px;
            margin-bottom: 20px;
            opacity: 0.8;
        }
        h1 {
            font-size: 28px;
            margin-bottom: 16px;
            color: #f39c12;
        }
        .message {
            font-size: 18px;
            color: #a0a0a0;
            margin-bottom: 30px;
            line-height: 1.6;
        }
        .port-info {
            background: rgba(255,255,255,0.1);
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 30px;
        }
        .port-info code {
            background: rgba(0,0,0,0.3);
            padding: 4px 12px;
            border-radius: 4px;
            font-family: 'Monaco', 'Menlo', monospace;
            color: #3498db;
            font-size: 16px;
        }
        .footer {
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid rgba(255,255,255,0.1);
        }
        .footer a {
            color: #3498db;
            text-decoration: none;
            font-weight: 500;
        }
        .footer a:hover {
            text-decoration: underline;
        }
        .logo {
            font-size: 14px;
            color: #666;
            margin-top: 10px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon">⚡</div>
        <h1>No Application Running</h1>
        <p class="message">
            The tunnel is active, but there's no application listening on the local port.
        </p>
        <div class="port-info">
            <p style="margin-bottom: 10px; color: #888;">Expected application at:</p>
            <code>${host}:${port}</code>
        </div>
        <p class="message" style="font-size: 14px;">
            Start your application on port <strong>${port}</strong> and refresh this page.
        </p>
        <div class="footer">
            <p>Powered by <a href="https://github.com/FJRG2007/opentunnel" target="_blank">OpenTunnel</a></p>
            <p class="logo">Self-hosted tunnel solution</p>
        </div>
    </div>
</body>
</html>`;
    }

    private forwardHttpRequest(
        host: string,
        port: number,
        request: HttpRequestMessage,
        useHttps: boolean
    ): Promise<{ statusCode: number; headers: Record<string, string | string[] | undefined>; body: string; isBase64?: boolean }> {
        return new Promise((resolve, reject) => {
            const httpModule = useHttps ? https : http;

            // Preserve original Host header for proper URL generation in apps like Next.js
            // Add X-Forwarded-* headers so the app knows it's behind a tunnel
            const originalHost = request.headers.host || request.headers.Host;
            const forwardedHeaders: Record<string, string | string[] | undefined> = {
                ...request.headers,
                "x-forwarded-host": originalHost,
                "x-forwarded-proto": useHttps ? "https" : "http",
                "x-forwarded-for": request.headers["x-forwarded-for"] || "127.0.0.1",
            };

            const options: http.RequestOptions = {
                hostname: host,
                port,
                path: request.path,
                method: request.method,
                headers: forwardedHeaders,
            };

            const req = httpModule.request(options, (res) => {
                const chunks: Buffer[] = [];

                res.on("data", (chunk) => chunks.push(chunk));
                res.on("end", () => {
                    // Use base64 encoding to preserve binary data (gzip, brotli, etc.)
                    const bodyBuffer = Buffer.concat(chunks);
                    resolve({
                        statusCode: res.statusCode || 500,
                        headers: res.headers as Record<string, string | string[] | undefined>,
                        body: bodyBuffer.toString("base64"),
                        isBase64: true,
                    });
                });
            });

            req.on("error", reject);
            req.setTimeout(30000, () => {
                req.destroy();
                reject(new Error("Request timeout"));
            });

            if (request.body) {
                req.write(request.body);
            }
            req.end();
        });
    }

    private handleTcpData(message: TcpDataMessage): void {
        const tunnel = this.tunnels.get(message.tunnelId);
        if (!tunnel) return;

        let socket = tunnel.tcpConnections.get(message.connectionId);

        if (!socket) {
            // Create new connection to local service
            socket = net.createConnection({
                host: tunnel.config.localHost,
                port: tunnel.config.localPort,
            });

            tunnel.tcpConnections.set(message.connectionId, socket);

            socket.on("data", (data) => {
                this.send({
                    type: "tcp_data",
                    id: generateId(),
                    timestamp: Date.now(),
                    tunnelId: message.tunnelId,
                    connectionId: message.connectionId,
                    data: encodeBase64(data),
                });
            });

            socket.on("close", () => {
                tunnel.tcpConnections.delete(message.connectionId);
                this.send({
                    type: "tcp_close",
                    id: generateId(),
                    timestamp: Date.now(),
                    tunnelId: message.tunnelId,
                    connectionId: message.connectionId,
                });
            });

            socket.on("error", (err) => {
                this.logger.error(`TCP connection error: ${err.message}`);
            });
        }

        const data = decodeBase64(message.data);
        socket.write(data);
    }

    private handleTcpClose(message: TcpCloseMessage): void {
        const tunnel = this.tunnels.get(message.tunnelId);
        if (!tunnel) return;

        const socket = tunnel.tcpConnections.get(message.connectionId);
        if (socket) {
            socket.destroy();
            tunnel.tcpConnections.delete(message.connectionId);
        }
    }

    private send(message: Message): void {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(encodeMessage(message));
        }
    }
}
