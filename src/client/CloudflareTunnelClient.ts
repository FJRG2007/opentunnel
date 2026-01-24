import { spawn, ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { existsSync } from "fs";
import { createServer, Server, IncomingMessage, ServerResponse, request as httpRequest } from "http";
import { request as httpsRequest } from "https";
import { TunnelProtocol, IpAccessConfig } from "../shared/types";
import { Logger } from "../shared/utils";
import { generateNotRunningPage } from "../lib/pages";
import { IpFilter } from "../shared/ip-filter";

// Import cloudflared package for automatic binary management
let cloudflaredModule: any = null;

async function getCloudflaredModule() {
    if (!cloudflaredModule) {
        cloudflaredModule = await import("cloudflared");
    }
    return cloudflaredModule;
}

export interface CloudflareTunnelConfig {
    hostname?: string; // Custom hostname (requires tunnel setup)
    protocol?: "http" | "https"; // Protocol for the origin (default: http)
    noTlsVerify?: boolean; // Skip TLS verification for origin
    // Named tunnel support
    tunnelName?: string; // Named tunnel to use (created via cloudflared tunnel create)
    credentialsPath?: string; // Path to tunnel credentials JSON file
    // IP filtering
    ipAccess?: IpAccessConfig; // IP access control configuration
}

export interface CloudflareTunnel {
    id: string;
    publicUrl: string;
    protocol: TunnelProtocol;
    localPort: number;
    localHost: string;
}

/**
 * Result from tunnel management operations
 */
export interface TunnelOperationResult {
    success: boolean;
    message?: string;
    error?: string;
}

export class CloudflareTunnelClient extends EventEmitter {
    private config: CloudflareTunnelConfig;
    private process: ChildProcess | null = null;
    private proxyServer: Server | null = null;
    private proxyPort: number = 0;
    private tunnels: Map<string, CloudflareTunnel> = new Map();
    private logger: Logger;
    private started = false;
    private binPath: string = "";
    private ipFilter: IpFilter | null = null;

    constructor(config: CloudflareTunnelConfig = {}) {
        super();
        this.config = {
            protocol: "http",
            ...config,
        };
        this.logger = new Logger("Cloudflare");

        // Initialize IP filter if configured
        if (config.ipAccess) {
            this.ipFilter = new IpFilter(config.ipAccess);
        }
    }

    /**
     * Update IP access configuration
     */
    setIpAccess(config: IpAccessConfig): void {
        this.config.ipAccess = config;
        if (!this.ipFilter) {
            this.ipFilter = new IpFilter(config);
        } else {
            this.ipFilter.setConfig(config);
        }
    }

    async connect(): Promise<void> {
        // Ensure cloudflared binary is installed via the npm package
        const cf = await getCloudflaredModule();
        this.binPath = cf.bin;

        if (!existsSync(this.binPath)) {
            this.logger.info("Installing cloudflared binary...");
            await cf.install(this.binPath);
            this.logger.info("cloudflared installed successfully");
        }

        this.started = true;
        this.logger.info("Cloudflare Tunnel client ready");
    }

    async disconnect(): Promise<void> {
        if (this.process) {
            this.process.kill();
            this.process = null;
        }
        if (this.proxyServer) {
            this.proxyServer.close();
            this.proxyServer = null;
        }
        this.tunnels.clear();
        this.started = false;
    }

    /**
     * Create a proxy server that forwards requests to the target and shows
     * a nice error page when the target is not running.
     * Also handles IP filtering before forwarding.
     */
    private async createProxyServer(
        targetHost: string,
        targetPort: number,
        useHttps: boolean
    ): Promise<number> {
        return new Promise((resolve, reject) => {
            this.proxyServer = createServer((req: IncomingMessage, res: ServerResponse) => {
                // IP filtering check
                if (this.ipFilter) {
                    const clientIp = IpFilter.extractClientIp(req);
                    const ipCheck = this.ipFilter.isAllowed(clientIp);

                    if (!ipCheck.allowed) {
                        this.logger.warn(`Request blocked for IP ${clientIp}: ${ipCheck.reason}`);
                        res.writeHead(403, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({
                            error: "Access denied",
                            reason: ipCheck.reason,
                        }));
                        return;
                    }
                }

                const requestFn = useHttps ? httpsRequest : httpRequest;

                const proxyReq = requestFn(
                    {
                        hostname: targetHost,
                        port: targetPort,
                        path: req.url,
                        method: req.method,
                        headers: req.headers,
                        rejectUnauthorized: !this.config.noTlsVerify,
                    },
                    (proxyRes) => {
                        res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
                        proxyRes.pipe(res);
                    }
                );

                proxyReq.on("error", (err: NodeJS.ErrnoException) => {
                    // Check if it's a connection refused error
                    if (err.code === "ECONNREFUSED") {
                        res.writeHead(503, { "Content-Type": "text/html; charset=utf-8" });
                        res.end(generateNotRunningPage({
                            host: targetHost,
                            port: targetPort,
                            provider: "Cloudflare Tunnel"
                        }));
                    } else {
                        res.writeHead(502, { "Content-Type": "text/plain" });
                        res.end(`Proxy Error: ${err.message}`);
                    }
                });

                req.pipe(proxyReq);
            });

            // Listen on a random available port
            this.proxyServer.listen(0, "127.0.0.1", () => {
                const address = this.proxyServer!.address();
                if (address && typeof address === "object") {
                    this.proxyPort = address.port;
                    resolve(this.proxyPort);
                } else {
                    reject(new Error("Failed to get proxy server port"));
                }
            });

            this.proxyServer.on("error", reject);
        });
    }

    /**
     * Create a quick tunnel (no authentication required)
     * This is the default mode - creates a random .trycloudflare.com URL
     */
    async createTunnel(options: {
        protocol: TunnelProtocol;
        localHost: string;
        localPort: number;
        subdomain?: string;
        remotePort?: number;
    }): Promise<{ tunnelId: string; publicUrl: string }> {
        // If a named tunnel is configured, use it instead
        if (this.config.tunnelName) {
            return this.runNamedTunnel(options);
        }

        // Ensure we have the binary path
        if (!this.binPath) {
            const cf = await getCloudflaredModule();
            this.binPath = cf.bin;
        }

        const useHttps = options.protocol === "https";

        // Create proxy server to handle "no app running" scenario and IP filtering
        const proxyPort = await this.createProxyServer(
            options.localHost,
            options.localPort,
            useHttps
        );

        // Build cloudflared arguments - point to our proxy server
        const args: string[] = ["tunnel"];
        const originUrl = `http://127.0.0.1:${proxyPort}`;
        args.push("--url", originUrl);

        // Add hostname if specified (for named tunnels)
        if (this.config.hostname) args.push("--hostname", this.config.hostname);

        return new Promise((resolve, reject) => {
            const tunnelId = `cf-${Date.now()}`;
            let publicUrl: string | null = null;
            let errorOutput = "";

            // Start cloudflared process using the binary from npm package
            this.process = spawn(this.binPath, args, {
                stdio: ["ignore", "pipe", "pipe"],
                // On Windows, we need shell: true for proper execution
                shell: process.platform === "win32",
            });

            // cloudflared outputs the URL to stderr
            const handleOutput = (data: Buffer) => {
                const output = data.toString();

                // Look for the trycloudflare.com URL in the output
                const urlMatch = output.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
                if (urlMatch && !publicUrl) {
                    publicUrl = urlMatch[0];

                    const tunnel: CloudflareTunnel = {
                        id: tunnelId,
                        publicUrl,
                        protocol: options.protocol,
                        localPort: options.localPort,
                        localHost: options.localHost,
                    };
                    this.tunnels.set(tunnel.id, tunnel);
                    this.emit("tunnel:created", { tunnelId: tunnel.id, publicUrl });
                    resolve({ tunnelId: tunnel.id, publicUrl });
                }

                // Also check for custom hostname URLs
                if (this.config.hostname && !publicUrl) {
                    const customUrlMatch = output.match(/https:\/\/[^\s]+/);
                    if (customUrlMatch) {
                        publicUrl = customUrlMatch[0];

                        const tunnel: CloudflareTunnel = {
                            id: tunnelId,
                            publicUrl,
                            protocol: options.protocol,
                            localPort: options.localPort,
                            localHost: options.localHost,
                        };
                        this.tunnels.set(tunnel.id, tunnel);
                        this.emit("tunnel:created", { tunnelId: tunnel.id, publicUrl });
                        resolve({ tunnelId: tunnel.id, publicUrl });
                    }
                }

                // Collect error output
                if (output.includes("ERR") || output.includes("error")) errorOutput += output;
            };

            this.process.stdout?.on("data", handleOutput);
            this.process.stderr?.on("data", handleOutput);

            this.process.on("error", (err) => {
                if (this.proxyServer) {
                    this.proxyServer.close();
                    this.proxyServer = null;
                }
                reject(new Error(`Failed to start cloudflared: ${err.message}`));
            });

            this.process.on("close", (code) => {
                if (!publicUrl) {
                    if (this.proxyServer) {
                        this.proxyServer.close();
                        this.proxyServer = null;
                    }
                    reject(new Error(errorOutput || `cloudflared exited with code ${code}`));
                }
            });

            // Set a timeout to fail if URL is not found within 30 seconds
            setTimeout(() => {
                if (!publicUrl) {
                    if (this.process) {
                        this.process.kill();
                        this.process = null;
                    }
                    if (this.proxyServer) {
                        this.proxyServer.close();
                        this.proxyServer = null;
                    }
                    reject(new Error("Timeout waiting for Cloudflare Tunnel URL. " + (errorOutput || "Check your internet connection.")));
                }
            }, 30000);
        });
    }

    /**
     * Run a named tunnel (requires prior cloudflared login and tunnel creation)
     * Named tunnels provide a persistent hostname
     */
    async runNamedTunnel(options: {
        protocol: TunnelProtocol;
        localHost: string;
        localPort: number;
    }): Promise<{ tunnelId: string; publicUrl: string }> {
        if (!this.config.tunnelName) {
            throw new Error("tunnelName is required for named tunnels");
        }

        // Ensure we have the binary path
        if (!this.binPath) {
            const cf = await getCloudflaredModule();
            this.binPath = cf.bin;
        }

        const useHttps = options.protocol === "https";

        // Create proxy server for IP filtering and error handling
        const proxyPort = await this.createProxyServer(
            options.localHost,
            options.localPort,
            useHttps
        );

        // Build cloudflared arguments for named tunnel
        const args: string[] = ["tunnel", "run"];

        // Add credentials file if specified
        if (this.config.credentialsPath) {
            args.push("--credentials-file", this.config.credentialsPath);
        }

        // Add origin configuration
        args.push("--url", `http://127.0.0.1:${proxyPort}`);

        // Add tunnel name
        args.push(this.config.tunnelName);

        return new Promise((resolve, reject) => {
            const tunnelId = `cf-named-${Date.now()}`;
            let started = false;
            let errorOutput = "";

            this.process = spawn(this.binPath, args, {
                stdio: ["ignore", "pipe", "pipe"],
                shell: process.platform === "win32",
            });

            const handleOutput = (data: Buffer) => {
                const output = data.toString();

                // Look for "Registered tunnel connection" or similar success message
                if ((output.includes("Registered tunnel connection") ||
                     output.includes("Connection registered") ||
                     output.includes("Started tunnel")) && !started) {
                    started = true;

                    // For named tunnels, the public URL is based on the hostname config
                    const publicUrl = this.config.hostname
                        ? `https://${this.config.hostname}`
                        : `https://${this.config.tunnelName}.cfargotunnel.com`;

                    const tunnel: CloudflareTunnel = {
                        id: tunnelId,
                        publicUrl,
                        protocol: options.protocol,
                        localPort: options.localPort,
                        localHost: options.localHost,
                    };
                    this.tunnels.set(tunnel.id, tunnel);
                    this.emit("tunnel:created", { tunnelId: tunnel.id, publicUrl });
                    resolve({ tunnelId: tunnel.id, publicUrl });
                }

                if (output.includes("ERR") || output.includes("error")) {
                    errorOutput += output;
                }
            };

            this.process.stdout?.on("data", handleOutput);
            this.process.stderr?.on("data", handleOutput);

            this.process.on("error", (err) => {
                if (this.proxyServer) {
                    this.proxyServer.close();
                    this.proxyServer = null;
                }
                reject(new Error(`Failed to start cloudflared: ${err.message}`));
            });

            this.process.on("close", (code) => {
                if (!started) {
                    if (this.proxyServer) {
                        this.proxyServer.close();
                        this.proxyServer = null;
                    }
                    reject(new Error(errorOutput || `cloudflared exited with code ${code}`));
                }
            });

            // Timeout for named tunnels
            setTimeout(() => {
                if (!started) {
                    if (this.process) {
                        this.process.kill();
                        this.process = null;
                    }
                    if (this.proxyServer) {
                        this.proxyServer.close();
                        this.proxyServer = null;
                    }
                    reject(new Error("Timeout waiting for named tunnel to start. " + (errorOutput || "Check credentials and tunnel name.")));
                }
            }, 60000); // Named tunnels may take longer
        });
    }

    async closeTunnel(tunnelId: string): Promise<void> {
        this.tunnels.delete(tunnelId);
        if (this.process) {
            this.process.kill();
            this.process = null;
        }
        if (this.proxyServer) {
            this.proxyServer.close();
            this.proxyServer = null;
        }
    }

    getTunnels(): CloudflareTunnel[] {
        return Array.from(this.tunnels.values());
    }

    // =========================================================================
    // Static tunnel management methods (for CLI commands)
    // =========================================================================

    /**
     * Check if cloudflared is installed
     */
    static async isAvailable(): Promise<boolean> {
        try {
            const cf = await getCloudflaredModule();
            return existsSync(cf.bin);
        } catch {
            return false;
        }
    }

    /**
     * Install cloudflared if not present
     */
    static async ensureInstalled(): Promise<string> {
        const cf = await getCloudflaredModule();
        if (!existsSync(cf.bin)) {
            await cf.install(cf.bin);
        }
        return cf.bin;
    }

    /**
     * Get cloudflared binary path
     */
    static async getBinPath(): Promise<string> {
        const cf = await getCloudflaredModule();
        return cf.bin;
    }

    /**
     * Create a new named tunnel
     */
    static async createNamedTunnel(name: string): Promise<TunnelOperationResult> {
        const binPath = await CloudflareTunnelClient.ensureInstalled();

        return new Promise((resolve) => {
            const proc = spawn(binPath, ["tunnel", "create", name], {
                stdio: ["ignore", "pipe", "pipe"],
                shell: process.platform === "win32",
            });

            let output = "";
            let errorOutput = "";

            proc.stdout?.on("data", (data) => { output += data.toString(); });
            proc.stderr?.on("data", (data) => { errorOutput += data.toString(); });

            proc.on("close", (code) => {
                if (code === 0) {
                    resolve({ success: true, message: output.trim() });
                } else {
                    resolve({ success: false, error: errorOutput.trim() || `Exit code ${code}` });
                }
            });

            proc.on("error", (err) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    /**
     * List all named tunnels
     */
    static async listTunnels(): Promise<{ success: boolean; tunnels?: string; error?: string }> {
        const binPath = await CloudflareTunnelClient.ensureInstalled();

        return new Promise((resolve) => {
            const proc = spawn(binPath, ["tunnel", "list"], {
                stdio: ["ignore", "pipe", "pipe"],
                shell: process.platform === "win32",
            });

            let output = "";
            let errorOutput = "";

            proc.stdout?.on("data", (data) => { output += data.toString(); });
            proc.stderr?.on("data", (data) => { errorOutput += data.toString(); });

            proc.on("close", (code) => {
                if (code === 0) {
                    resolve({ success: true, tunnels: output.trim() });
                } else {
                    resolve({ success: false, error: errorOutput.trim() || `Exit code ${code}` });
                }
            });

            proc.on("error", (err) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    /**
     * Delete a named tunnel
     */
    static async deleteTunnel(name: string): Promise<TunnelOperationResult> {
        const binPath = await CloudflareTunnelClient.ensureInstalled();

        return new Promise((resolve) => {
            const proc = spawn(binPath, ["tunnel", "delete", name], {
                stdio: ["ignore", "pipe", "pipe"],
                shell: process.platform === "win32",
            });

            let output = "";
            let errorOutput = "";

            proc.stdout?.on("data", (data) => { output += data.toString(); });
            proc.stderr?.on("data", (data) => { errorOutput += data.toString(); });

            proc.on("close", (code) => {
                if (code === 0) {
                    resolve({ success: true, message: output.trim() });
                } else {
                    resolve({ success: false, error: errorOutput.trim() || `Exit code ${code}` });
                }
            });

            proc.on("error", (err) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    /**
     * Route DNS for a tunnel
     */
    static async routeDns(tunnelName: string, hostname: string): Promise<TunnelOperationResult> {
        const binPath = await CloudflareTunnelClient.ensureInstalled();

        return new Promise((resolve) => {
            const proc = spawn(binPath, ["tunnel", "route", "dns", tunnelName, hostname], {
                stdio: ["ignore", "pipe", "pipe"],
                shell: process.platform === "win32",
            });

            let output = "";
            let errorOutput = "";

            proc.stdout?.on("data", (data) => { output += data.toString(); });
            proc.stderr?.on("data", (data) => { errorOutput += data.toString(); });

            proc.on("close", (code) => {
                if (code === 0) {
                    resolve({ success: true, message: output.trim() });
                } else {
                    resolve({ success: false, error: errorOutput.trim() || `Exit code ${code}` });
                }
            });

            proc.on("error", (err) => {
                resolve({ success: false, error: err.message });
            });
        });
    }
}
