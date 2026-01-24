import { spawn, ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { createServer, Server, IncomingMessage, ServerResponse, request as httpRequest } from "http";
import { request as httpsRequest } from "https";
import { TunnelProtocol, IpAccessConfig } from "../shared/types";
import { Logger } from "../shared/utils";
import { IpFilter } from "../shared/ip-filter";
import { generateNotRunningPage } from "../lib/pages";
import { resolveNgrokToken } from "../shared/credentials";

export interface NgrokConfig {
    authtoken?: string;
    region?: "us" | "eu" | "ap" | "au" | "sa" | "jp" | "in";
    binPath?: string;
    // IP filtering (note: filtering happens after ngrok forwards - see docs)
    ipAccess?: IpAccessConfig;
}

export interface NgrokTunnel {
    id: string;
    publicUrl: string;
    protocol: TunnelProtocol;
    localPort: number;
    localHost: string;
}

export class NgrokClient extends EventEmitter {
    private config: NgrokConfig;
    private process: ChildProcess | null = null;
    private proxyServer: Server | null = null;
    private proxyPort: number = 0;
    private tunnels: Map<string, NgrokTunnel> = new Map();
    private apiUrl = "http://127.0.0.1:4040/api";
    private logger: Logger;
    private started = false;
    private ipFilter: IpFilter | null = null;

    constructor(config: NgrokConfig = {}) {
        super();
        this.config = {
            region: "us",
            binPath: "ngrok",
            ...config,
        };
        this.logger = new Logger("Ngrok");

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
        // Resolve token with priority: config > env > stored credentials
        const token = resolveNgrokToken({
            cliToken: this.config.authtoken,
        });

        if (token) {
            this.config.authtoken = token;
            await this.runCommand(["config", "add-authtoken", token]);
        }

        this.started = true;
        this.logger.info("Ngrok client ready");
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
     * Create a proxy server for IP filtering
     *
     * NOTE: For ngrok, IP filtering happens AFTER ngrok forwards the request.
     * This means the request has already reached the public ngrok URL.
     * This is a documented limitation - true origin filtering would require
     * ngrok's IP Policies feature (paid feature).
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
                        rejectUnauthorized: false,
                    },
                    (proxyRes) => {
                        res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
                        proxyRes.pipe(res);
                    }
                );

                proxyReq.on("error", (err: NodeJS.ErrnoException) => {
                    if (err.code === "ECONNREFUSED") {
                        res.writeHead(503, { "Content-Type": "text/html; charset=utf-8" });
                        res.end(generateNotRunningPage({
                            host: targetHost,
                            port: targetPort,
                            provider: "ngrok"
                        }));
                    } else {
                        res.writeHead(502, { "Content-Type": "text/plain" });
                        res.end(`Proxy Error: ${err.message}`);
                    }
                });

                req.pipe(proxyReq);
            });

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

    async createTunnel(options: {
        protocol: TunnelProtocol;
        localHost: string;
        localPort: number;
        subdomain?: string;
        remotePort?: number;
    }): Promise<{ tunnelId: string; publicUrl: string }> {
        const args: string[] = [];
        const useHttps = options.protocol === "https";

        // Determine if we need a proxy server for IP filtering
        let targetPort = options.localPort;
        let targetHost = options.localHost;

        if (this.ipFilter) {
            // Create proxy server for IP filtering
            const proxyPort = await this.createProxyServer(
                options.localHost,
                options.localPort,
                useHttps
            );
            targetPort = proxyPort;
            targetHost = "127.0.0.1";

            this.logger.info("IP filtering enabled (note: filtering happens after ngrok forwards)");
        }

        if (options.protocol === "http" || options.protocol === "https") {
            args.push("http");
            if (options.subdomain) {
                args.push("--subdomain", options.subdomain);
            }
            args.push(`${targetHost}:${targetPort}`);
        } else if (options.protocol === "tcp") {
            args.push("tcp");
            if (options.remotePort) {
                args.push("--remote-addr", `0.tcp.ngrok.io:${options.remotePort}`);
            }
            args.push(`${targetPort}`);
        }

        if (this.config.region) {
            args.push("--region", this.config.region);
        }

        // Start ngrok process
        return new Promise((resolve, reject) => {
            this.process = spawn(this.config.binPath!, args, {
                stdio: ["ignore", "pipe", "pipe"],
            });

            let output = "";

            this.process.stdout?.on("data", (data) => {
                output += data.toString();
            });

            this.process.stderr?.on("data", (data) => {
                this.logger.error(data.toString());
            });

            this.process.on("error", (err) => {
                if (this.proxyServer) {
                    this.proxyServer.close();
                    this.proxyServer = null;
                }
                reject(new Error(`Failed to start ngrok: ${err.message}`));
            });

            // Wait for ngrok to start and get tunnel URL from API
            setTimeout(async () => {
                try {
                    const tunnelInfo = await this.getTunnelFromApi();
                    if (tunnelInfo) {
                        const tunnel: NgrokTunnel = {
                            id: tunnelInfo.name,
                            publicUrl: tunnelInfo.public_url,
                            protocol: options.protocol,
                            localPort: options.localPort,
                            localHost: options.localHost,
                        };
                        this.tunnels.set(tunnel.id, tunnel);
                        this.emit("tunnel:created", { tunnelId: tunnel.id, publicUrl: tunnel.publicUrl });
                        resolve({ tunnelId: tunnel.id, publicUrl: tunnel.publicUrl });
                    } else {
                        if (this.proxyServer) {
                            this.proxyServer.close();
                            this.proxyServer = null;
                        }
                        reject(new Error("Failed to get tunnel URL from ngrok"));
                    }
                } catch (err) {
                    if (this.proxyServer) {
                        this.proxyServer.close();
                        this.proxyServer = null;
                    }
                    reject(err);
                }
            }, 2000);
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

    getTunnels(): NgrokTunnel[] {
        return Array.from(this.tunnels.values());
    }

    private async getTunnelFromApi(): Promise<{ name: string; public_url: string } | null> {
        return new Promise((resolve) => {
            const http = require("http");
            http.get(`${this.apiUrl}/tunnels`, (res: any) => {
                let data = "";
                res.on("data", (chunk: string) => (data += chunk));
                res.on("end", () => {
                    try {
                        const json = JSON.parse(data);
                        if (json.tunnels && json.tunnels.length > 0) {
                            resolve(json.tunnels[0]);
                        } else {
                            resolve(null);
                        }
                    } catch {
                        resolve(null);
                    }
                });
            }).on("error", () => resolve(null));
        });
    }

    private runCommand(args: string[]): Promise<string> {
        return new Promise((resolve, reject) => {
            const proc = spawn(this.config.binPath!, args, {
                stdio: ["ignore", "pipe", "pipe"],
            });

            let output = "";
            let error = "";

            proc.stdout?.on("data", (data) => {
                output += data.toString();
            });

            proc.stderr?.on("data", (data) => {
                error += data.toString();
            });

            proc.on("close", (code) => {
                if (code === 0) {
                    resolve(output);
                } else {
                    reject(new Error(error || `Process exited with code ${code}`));
                }
            });

            proc.on("error", reject);
        });
    }
}
