import { IncomingMessage } from "http";
import { IpAccessConfig } from "./types";

/**
 * Result of an IP access check
 */
export interface IpCheckResult {
    allowed: boolean;
    reason?: string;
}

/**
 * Shared IP filtering class for cross-provider security
 *
 * Supports:
 * - Allowlist mode: Only IPs in the list are allowed
 * - Denylist mode: IPs in the list are denied, others allowed
 * - CIDR notation (e.g., 192.168.0.0/16)
 * - IPv6-mapped IPv4 normalization
 * - X-Forwarded-For / CF-Connecting-IP header extraction
 */
export class IpFilter {
    private config: IpAccessConfig;

    constructor(config?: IpAccessConfig) {
        this.config = config || { mode: "all" };
    }

    /**
     * Update the filter configuration
     */
    setConfig(config: IpAccessConfig): void {
        this.config = config;
    }

    /**
     * Get the current configuration
     */
    getConfig(): IpAccessConfig {
        return this.config;
    }

    /**
     * Check if an IP matches a CIDR range or single IP
     */
    ipMatchesCidr(ip: string, cidr: string): boolean {
        // Normalize IPv6-mapped IPv4 addresses
        const normalizedIp = IpFilter.normalizeIp(ip);
        const normalizedCidr = IpFilter.normalizeIp(cidr);

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

    /**
     * Check if an IP is in a list (supports CIDR notation)
     */
    ipInList(ip: string, list: string[]): boolean {
        return list.some(entry => this.ipMatchesCidr(ip, entry));
    }

    /**
     * Check if an IP is allowed based on the access config
     */
    isAllowed(ip: string): IpCheckResult {
        // Default: allow all
        if (!this.config || this.config.mode === "all") {
            return { allowed: true };
        }

        // Normalize IP
        const normalizedIp = IpFilter.normalizeIp(ip);

        if (this.config.mode === "allowlist") {
            // Only allow IPs in the allowList
            if (this.config.allowList && this.ipInList(normalizedIp, this.config.allowList)) {
                return { allowed: true };
            }
            return { allowed: false, reason: `IP ${normalizedIp} not in allowlist` };
        }

        if (this.config.mode === "denylist") {
            // Deny IPs in the denyList, allow others
            if (this.config.denyList && this.ipInList(normalizedIp, this.config.denyList)) {
                return { allowed: false, reason: `IP ${normalizedIp} is in denylist` };
            }
            return { allowed: true };
        }

        return { allowed: true };
    }

    /**
     * Normalize an IP address (removes IPv6-mapped IPv4 prefix)
     */
    static normalizeIp(ip: string): string {
        return ip.replace(/^::ffff:/, "");
    }

    /**
     * Extract client IP from various headers and socket
     *
     * Priority:
     * 1. CF-Connecting-IP (Cloudflare)
     * 2. X-Real-IP (nginx, common proxies)
     * 3. X-Forwarded-For (first IP, standard proxy header)
     * 4. Socket remoteAddress (direct connection)
     */
    static extractClientIp(req: IncomingMessage): string {
        // Cloudflare specific header
        const cfConnectingIp = req.headers["cf-connecting-ip"];
        if (cfConnectingIp) {
            const ip = Array.isArray(cfConnectingIp) ? cfConnectingIp[0] : cfConnectingIp;
            return IpFilter.normalizeIp(ip.trim());
        }

        // X-Real-IP header (nginx, etc.)
        const xRealIp = req.headers["x-real-ip"];
        if (xRealIp) {
            const ip = Array.isArray(xRealIp) ? xRealIp[0] : xRealIp;
            return IpFilter.normalizeIp(ip.trim());
        }

        // X-Forwarded-For header (first IP is the client)
        const xForwardedFor = req.headers["x-forwarded-for"];
        if (xForwardedFor) {
            const forwardedIps = Array.isArray(xForwardedFor)
                ? xForwardedFor[0]
                : xForwardedFor;
            const firstIp = forwardedIps.split(",")[0].trim();
            return IpFilter.normalizeIp(firstIp);
        }

        // Direct socket connection
        const socketAddress = req.socket.remoteAddress;
        if (socketAddress) {
            return IpFilter.normalizeIp(socketAddress);
        }

        return "unknown";
    }

    /**
     * Extract client IP from headers object (for use without IncomingMessage)
     */
    static extractClientIpFromHeaders(headers: Record<string, string | string[] | undefined>, socketAddress?: string): string {
        // Cloudflare specific header
        const cfConnectingIp = headers["cf-connecting-ip"];
        if (cfConnectingIp) {
            const ip = Array.isArray(cfConnectingIp) ? cfConnectingIp[0] : cfConnectingIp;
            return IpFilter.normalizeIp(ip.trim());
        }

        // X-Real-IP header
        const xRealIp = headers["x-real-ip"];
        if (xRealIp) {
            const ip = Array.isArray(xRealIp) ? xRealIp[0] : xRealIp;
            return IpFilter.normalizeIp(ip.trim());
        }

        // X-Forwarded-For header
        const xForwardedFor = headers["x-forwarded-for"];
        if (xForwardedFor) {
            const forwardedIps = Array.isArray(xForwardedFor)
                ? xForwardedFor[0]
                : xForwardedFor;
            const firstIp = forwardedIps.split(",")[0].trim();
            return IpFilter.normalizeIp(firstIp);
        }

        // Socket address fallback
        if (socketAddress) {
            return IpFilter.normalizeIp(socketAddress);
        }

        return "unknown";
    }

    /**
     * Merge two IP access configs, with the second one taking priority for non-undefined values
     * Useful for per-tunnel config overriding global config
     */
    static mergeConfigs(base?: IpAccessConfig, override?: IpAccessConfig): IpAccessConfig | undefined {
        if (!base && !override) {
            return undefined;
        }

        if (!base) {
            return override;
        }

        if (!override) {
            return base;
        }

        return {
            mode: override.mode || base.mode,
            allowList: override.allowList || base.allowList,
            denyList: override.denyList || base.denyList,
        };
    }
}

/**
 * Create a filter middleware function for HTTP servers
 *
 * @param config IP access configuration
 * @param onDenied Optional callback when access is denied
 * @returns Middleware function that returns true if allowed, false if denied
 */
export function createIpFilterMiddleware(
    config?: IpAccessConfig,
    onDenied?: (ip: string, reason: string) => void
): (req: IncomingMessage) => IpCheckResult {
    const filter = new IpFilter(config);

    return (req: IncomingMessage): IpCheckResult => {
        const clientIp = IpFilter.extractClientIp(req);
        const result = filter.isAllowed(clientIp);

        if (!result.allowed && onDenied) {
            onDenied(clientIp, result.reason || "Access denied");
        }

        return result;
    };
}
