import { nanoid } from "nanoid";
import { Message } from "./types";

export function generateId(length: number = 12): string {
    return nanoid(length);
};

export function generateSubdomain(): string {
    const adjectives = ["swift", "bright", "cool", "fast", "wild", "bold", "keen", "calm"];
    const nouns = ["tunnel", "stream", "link", "pipe", "gate", "port", "node", "hub"];
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    const num = Math.floor(Math.random() * 1000);
    return `${adj}-${noun}-${num}`;
};

export function encodeMessage(message: Message): string {
    return JSON.stringify(message);
};

export function decodeMessage(data: string): Message {
    return JSON.parse(data);
};

export function encodeBase64(buffer: Buffer): string {
    return buffer.toString("base64");
};

export function decodeBase64(str: string): Buffer {
    return Buffer.from(str, "base64");
};

export function formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
};

export function formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
};

export function parsePortRange(range: string): { min: number; max: number } {
    const [min, max] = range.split("-").map(Number);
    return { min, max: max || min };
};

export function isPortAvailable(port: number, usedPorts: Set<number>): boolean {
    return !usedPorts.has(port);
};

export function getNextAvailablePort(
    min: number,
    max: number,
    usedPorts: Set<number>
): number | null {
    for (let port = min; port <= max; port++) {
        if (!usedPorts.has(port)) return port;
    }
    return null;
};

export function extractSubdomain(host: string, baseDomain: string, basePath: string = "op"): string | null {
    const hostLower = host.toLowerCase();
    const baseLower = baseDomain.toLowerCase();
    const fullBase = `${basePath}.${baseLower}`;

    // Check for pattern: subdomain.op.domain.com
    if (hostLower.endsWith(`.${fullBase}`)) return hostLower.slice(0, -(fullBase.length + 1));

    // Check for pattern: subdomain.domain.com (legacy support)
    if (hostLower === baseLower) return null;
    if (!hostLower.endsWith(`.${baseLower}`)) return null;

    return hostLower.slice(0, -(baseLower.length + 1));
};

// Multi-domain version: tries to match against multiple domains
export interface DomainMatch {
    subdomain: string;
    domain: string;
    basePath: string;
}

export function extractSubdomainMulti(
    host: string,
    domains: { domain: string; basePath: string }[]
): DomainMatch | null {
    const hostLower = host.toLowerCase();

    for (const { domain, basePath } of domains) {
        const baseLower = domain.toLowerCase();
        const fullBase = `${basePath}.${baseLower}`;

        // Check for pattern: subdomain.basePath.domain.com
        if (hostLower.endsWith(`.${fullBase}`)) {
            return {
                subdomain: hostLower.slice(0, -(fullBase.length + 1)),
                domain,
                basePath,
            };
        }

        // Check for pattern: subdomain.domain.com (direct, no basePath)
        if (basePath === "" && hostLower.endsWith(`.${baseLower}`) && hostLower !== baseLower) {
            return {
                subdomain: hostLower.slice(0, -(baseLower.length + 1)),
                domain,
                basePath,
            };
        }
    }

    return null;
};

export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
};

export class Logger {
    private silent: boolean;

    constructor(private prefix: string, private debug: boolean = false, silent: boolean = false) {
        this.silent = silent;
    }

    setSilent(silent: boolean): void {
        this.silent = silent;
    };

    info(message: string, ...args: any[]): void {
        if (!this.silent) console.log(`[${this.prefix}] ${message}`, ...args);
    };

    error(message: string, ...args: any[]): void {
        if (!this.silent) console.error(`[${this.prefix}] ERROR: ${message}`, ...args);
    };

    warn(message: string, ...args: any[]): void {
        if (!this.silent) console.warn(`[${this.prefix}] WARN: ${message}`, ...args);
    };

    log(message: string, ...args: any[]): void {
        if (!this.silent && this.debug) console.log(`[${this.prefix}] DEBUG: ${message}`, ...args);
    };
};