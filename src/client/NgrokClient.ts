import { spawn, ChildProcess } from "child_process";
import https from "https";
import { EventEmitter } from "events";
import { TunnelProtocol } from "../shared/types";
import { Logger } from "../shared/utils";

export interface NgrokConfig {
    authtoken?: string;
    region?: "us" | "eu" | "ap" | "au" | "sa" | "jp" | "in";
    binPath?: string;
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
    private tunnels: Map<string, NgrokTunnel> = new Map();
    private apiUrl = "http://127.0.0.1:4040/api";
    private logger: Logger;
    private started = false;

    constructor(config: NgrokConfig = {}) {
        super();
        this.config = {
            region: "us",
            binPath: "ngrok",
            ...config,
        };
        this.logger = new Logger("Ngrok");
    }

    async connect(): Promise<void> {
        if (this.config.authtoken) {
            await this.runCommand(["config", "add-authtoken", this.config.authtoken]);
        }
        this.started = true;
        this.logger.info("Ngrok client ready");
    }

    async disconnect(): Promise<void> {
        if (this.process) {
            this.process.kill();
            this.process = null;
        }
        this.tunnels.clear();
        this.started = false;
    }

    async createTunnel(options: {
        protocol: TunnelProtocol;
        localHost: string;
        localPort: number;
        subdomain?: string;
        remotePort?: number;
    }): Promise<{ tunnelId: string; publicUrl: string }> {
        const args: string[] = [];

        if (options.protocol === "http" || options.protocol === "https") {
            args.push("http");
            if (options.subdomain) {
                args.push("--subdomain", options.subdomain);
            }
            args.push(`${options.localHost}:${options.localPort}`);
        } else if (options.protocol === "tcp") {
            args.push("tcp");
            if (options.remotePort) {
                args.push("--remote-addr", `0.tcp.ngrok.io:${options.remotePort}`);
            }
            args.push(`${options.localPort}`);
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
                        reject(new Error("Failed to get tunnel URL from ngrok"));
                    }
                } catch (err) {
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
