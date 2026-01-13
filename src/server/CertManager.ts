import * as acme from "acme-client";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as http from "http";
import * as forge from "node-forge";
import Cloudflare from "cloudflare";
import { Logger } from "../shared/utils";

interface CertificateInfo {
    cert: string;
    key: string;
    expiresAt: Date;
    domains: string[];
}

interface PendingChallenge {
    token: string;
    keyAuthorization: string;
}

interface DnsChallenge {
    recordId: string;
    zoneId: string;
}

export class CertManager {
    private certsDir: string;
    private logger: Logger;
    private accountKey: crypto.KeyObject | null = null;
    private client: acme.Client | null = null;
    private pendingChallenges: Map<string, PendingChallenge> = new Map();
    private pendingDnsChallenges: Map<string, DnsChallenge> = new Map();
    private isProduction: boolean;
    private email: string;
    private cloudflare: Cloudflare | null = null;
    private cloudflareZoneId: string | null = null;

    constructor(options: {
        certsDir?: string;
        email?: string;
        production?: boolean;
        cloudflareToken?: string;
    }) {
        this.certsDir = options.certsDir || path.join(process.cwd(), ".certs");
        this.email = options.email || "admin@localhost";
        this.isProduction = options.production ?? false;
        this.logger = new Logger("CertManager");

        // Ensure certs directory exists
        if (!fs.existsSync(this.certsDir)) {
            fs.mkdirSync(this.certsDir, { recursive: true });
        }

        // Initialize Cloudflare if token provided
        if (options.cloudflareToken) {
            this.cloudflare = new Cloudflare({
                apiToken: options.cloudflareToken,
            });
        }
    }

    async initialize(): Promise<void> {
        // Load or create account key
        const accountKeyPath = path.join(this.certsDir, "account.key");

        if (fs.existsSync(accountKeyPath)) {
            const keyPem = fs.readFileSync(accountKeyPath, "utf-8");
            this.accountKey = crypto.createPrivateKey(keyPem);
            this.logger.info("Loaded existing ACME account key");
        } else {
            const { privateKey } = crypto.generateKeyPairSync("rsa", {
                modulusLength: 4096,
            });
            this.accountKey = privateKey;
            fs.writeFileSync(
                accountKeyPath,
                privateKey.export({ type: "pkcs8", format: "pem" })
            );
            this.logger.info("Generated new ACME account key");
        }

        // Create ACME client
        const directoryUrl = this.isProduction
            ? acme.directory.letsencrypt.production
            : acme.directory.letsencrypt.staging;

        this.client = new acme.Client({
            directoryUrl,
            accountKey: this.accountKey.export({ type: "pkcs8", format: "pem" }) as string,
        });

        this.logger.info(`ACME initialized (${this.isProduction ? "production" : "staging"})`);
    }

    async findCloudflareZone(domain: string): Promise<string | null> {
        if (!this.cloudflare) return null;

        try {
            // Extract root domain (e.g., "example.com" from "sub.example.com")
            const parts = domain.split(".");
            const rootDomain = parts.slice(-2).join(".");

            const zones = await this.cloudflare.zones.list({ name: rootDomain });

            if (zones.result && zones.result.length > 0) {
                this.cloudflareZoneId = zones.result[0].id;
                this.logger.info(`Found Cloudflare zone: ${rootDomain} (${this.cloudflareZoneId})`);
                return this.cloudflareZoneId;
            }
        } catch (err: any) {
            this.logger.error(`Cloudflare zone lookup failed: ${err.message}`);
        }

        return null;
    }

    async getCertificate(domains: string[]): Promise<CertificateInfo | null> {
        const primaryDomain = domains[0].replace("*.", "wildcard.");
        const certPath = path.join(this.certsDir, `${primaryDomain}.crt`);
        const keyPath = path.join(this.certsDir, `${primaryDomain}.key`);
        const metaPath = path.join(this.certsDir, `${primaryDomain}.json`);

        // Check if we have a valid cached certificate
        if (fs.existsSync(certPath) && fs.existsSync(keyPath) && fs.existsSync(metaPath)) {
            const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
            const expiresAt = new Date(meta.expiresAt);

            // If certificate is still valid (with 7 day buffer), return it
            const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
            if (expiresAt.getTime() - Date.now() > sevenDaysMs) {
                this.logger.info(`Using cached certificate for ${domains[0]}`);
                return {
                    cert: fs.readFileSync(certPath, "utf-8"),
                    key: fs.readFileSync(keyPath, "utf-8"),
                    expiresAt,
                    domains: meta.domains,
                };
            }

            this.logger.info(`Certificate expiring soon, renewing...`);
        }

        return null;
    }

    async requestCertificate(domains: string[]): Promise<CertificateInfo> {
        if (!this.client) {
            throw new Error("CertManager not initialized");
        }

        const hasWildcard = domains.some(d => d.startsWith("*."));
        const primaryDomain = domains[0].replace("*.", "wildcard.");

        this.logger.info(`Requesting certificate for: ${domains.join(", ")}`);

        // Create CSR
        const [key, csr] = await acme.crypto.createCsr({
            commonName: domains[0],
            altNames: domains.length > 1 ? domains.slice(1) : undefined,
        });

        // Determine challenge type based on whether we have wildcard and Cloudflare
        const usesDns01 = hasWildcard && this.cloudflare;

        if (hasWildcard && !this.cloudflare) {
            throw new Error(
                "Wildcard certificates require DNS-01 challenge. " +
                "Please provide --cloudflare-token or use non-wildcard domain."
            );
        }

        // Request certificate
        const cert = await this.client.auto({
            csr,
            email: this.email,
            termsOfServiceAgreed: true,
            challengeCreateFn: async (authz, challenge, keyAuthorization) => {
                if (challenge.type === "dns-01" && this.cloudflare) {
                    await this.createDnsChallenge(authz.identifier.value, keyAuthorization);
                } else if (challenge.type === "http-01") {
                    this.pendingChallenges.set(challenge.token, {
                        token: challenge.token,
                        keyAuthorization,
                    });
                    this.logger.info(`HTTP-01 challenge ready for ${authz.identifier.value}`);
                }
            },
            challengeRemoveFn: async (authz, challenge) => {
                if (challenge.type === "dns-01" && this.cloudflare) {
                    await this.removeDnsChallenge(authz.identifier.value);
                } else if (challenge.type === "http-01") {
                    this.pendingChallenges.delete(challenge.token);
                }
            },
            challengePriority: usesDns01 ? ["dns-01"] : ["http-01"],
        });

        // Parse certificate to get expiry
        const certInfo = await acme.crypto.readCertificateInfo(cert);
        const expiresAt = certInfo.notAfter;

        // Save certificate and key
        const certPath = path.join(this.certsDir, `${primaryDomain}.crt`);
        const keyPath = path.join(this.certsDir, `${primaryDomain}.key`);
        const metaPath = path.join(this.certsDir, `${primaryDomain}.json`);

        fs.writeFileSync(certPath, cert);
        fs.writeFileSync(keyPath, key.toString());
        fs.writeFileSync(metaPath, JSON.stringify({
            domains,
            expiresAt: expiresAt.toISOString(),
            issuedAt: new Date().toISOString(),
        }, null, 2));

        this.logger.info(`Certificate saved, expires: ${expiresAt.toISOString()}`);

        return {
            cert,
            key: key.toString(),
            expiresAt,
            domains,
        };
    }

    private async createDnsChallenge(domain: string, keyAuthorization: string): Promise<void> {
        if (!this.cloudflare || !this.cloudflareZoneId) {
            throw new Error("Cloudflare not configured");
        }

        // Create DNS TXT record for ACME challenge
        const recordName = `_acme-challenge.${domain.replace("*.", "")}`;
        const digestValue = crypto
            .createHash("sha256")
            .update(keyAuthorization)
            .digest("base64url");

        this.logger.info(`Creating DNS-01 challenge: ${recordName}`);

        try {
            const record = await this.cloudflare.dns.records.create({
                zone_id: this.cloudflareZoneId,
                type: "TXT",
                name: recordName,
                content: digestValue,
                ttl: 120,
            });

            this.pendingDnsChallenges.set(domain, {
                recordId: record.id!,
                zoneId: this.cloudflareZoneId,
            });

            // Wait for DNS propagation
            this.logger.info("Waiting for DNS propagation (30s)...");
            await new Promise(resolve => setTimeout(resolve, 30000));

        } catch (err: any) {
            this.logger.error(`DNS challenge creation failed: ${err.message}`);
            throw err;
        }
    }

    private async removeDnsChallenge(domain: string): Promise<void> {
        const challenge = this.pendingDnsChallenges.get(domain);
        if (!challenge || !this.cloudflare) return;

        try {
            await this.cloudflare.dns.records.delete(challenge.recordId, {
                zone_id: challenge.zoneId,
            });
            this.pendingDnsChallenges.delete(domain);
            this.logger.info(`Removed DNS challenge for ${domain}`);
        } catch (err: any) {
            this.logger.error(`DNS challenge removal failed: ${err.message}`);
        }
    }

    // Handle HTTP-01 challenge requests
    handleChallengeRequest(token: string): string | null {
        const challenge = this.pendingChallenges.get(token);
        if (challenge) {
            return challenge.keyAuthorization;
        }
        return null;
    }

    // Create HTTP server for ACME challenges (port 80)
    createChallengeServer(): http.Server {
        const server = http.createServer((req, res) => {
            const url = req.url || "";

            // Handle ACME HTTP-01 challenge
            if (url.startsWith("/.well-known/acme-challenge/")) {
                const token = url.split("/").pop() || "";
                const keyAuth = this.handleChallengeRequest(token);

                if (keyAuth) {
                    this.logger.info(`Serving ACME challenge for token: ${token.substring(0, 10)}...`);
                    res.writeHead(200, { "Content-Type": "text/plain" });
                    res.end(keyAuth);
                    return;
                }
            }

            // Redirect all other HTTP to HTTPS
            const host = req.headers.host || "";
            res.writeHead(301, { Location: `https://${host}${url}` });
            res.end();
        });

        return server;
    }

    // Check if certificate exists
    hasCertificate(domain: string): boolean {
        const safeDomain = domain.replace("*.", "wildcard.");
        const certPath = path.join(this.certsDir, `${safeDomain}.crt`);
        const keyPath = path.join(this.certsDir, `${safeDomain}.key`);
        return fs.existsSync(certPath) && fs.existsSync(keyPath);
    }

    // Load certificate from disk
    loadCertificate(domain: string): { cert: string; key: string } | null {
        const safeDomain = domain.replace("*.", "wildcard.");
        const certPath = path.join(this.certsDir, `${safeDomain}.crt`);
        const keyPath = path.join(this.certsDir, `${safeDomain}.key`);

        if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
            return {
                cert: fs.readFileSync(certPath, "utf-8"),
                key: fs.readFileSync(keyPath, "utf-8"),
            };
        }

        return null;
    }

    hasCloudflare(): boolean {
        return this.cloudflare !== null;
    }

    /**
     * Generate a self-signed certificate for local/development use.
     * No external dependencies required.
     */
    generateSelfSignedCertificate(domain: string, options?: {
        validDays?: number;
        organization?: string;
    }): CertificateInfo {
        const validDays = options?.validDays || 365;
        const org = options?.organization || "OpenTunnel";
        const safeDomain = domain.replace("*.", "wildcard.");

        const certPath = path.join(this.certsDir, `${safeDomain}.crt`);
        const keyPath = path.join(this.certsDir, `${safeDomain}.key`);
        const metaPath = path.join(this.certsDir, `${safeDomain}.json`);

        // Check if we already have a valid self-signed cert
        if (fs.existsSync(certPath) && fs.existsSync(keyPath) && fs.existsSync(metaPath)) {
            try {
                const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
                const expiresAt = new Date(meta.expiresAt);

                // If still valid (with 7 day buffer), use it
                const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
                if (expiresAt.getTime() - Date.now() > sevenDaysMs) {
                    this.logger.info(`Using existing self-signed certificate for ${domain}`);
                    return {
                        cert: fs.readFileSync(certPath, "utf-8"),
                        key: fs.readFileSync(keyPath, "utf-8"),
                        expiresAt,
                        domains: meta.domains,
                    };
                }
            } catch {
                // Regenerate if meta is corrupted
            }
        }

        this.logger.info(`Generating self-signed certificate for ${domain}...`);

        // Generate key pair using node-forge
        const keys = forge.pki.rsa.generateKeyPair(2048);

        // Create certificate
        const cert = forge.pki.createCertificate();
        cert.publicKey = keys.publicKey;
        cert.serialNumber = Date.now().toString(16);

        // Set validity
        const now = new Date();
        const expiresAt = new Date(now.getTime() + validDays * 24 * 60 * 60 * 1000);
        cert.validity.notBefore = now;
        cert.validity.notAfter = expiresAt;

        // Set subject and issuer (self-signed, so they're the same)
        const attrs = [
            { name: "commonName", value: domain },
            { name: "organizationName", value: org },
        ];
        cert.setSubject(attrs);
        cert.setIssuer(attrs);

        // Set extensions for proper SSL/TLS usage
        cert.setExtensions([
            {
                name: "basicConstraints",
                cA: false,
            },
            {
                name: "keyUsage",
                critical: true,
                digitalSignature: true,
                keyEncipherment: true,
            },
            {
                name: "extKeyUsage",
                serverAuth: true,
            },
            {
                name: "subjectAltName",
                altNames: [
                    { type: 2, value: domain }, // DNS
                    { type: 2, value: `*.${domain.replace("*.", "")}` }, // Wildcard DNS
                ],
            },
        ]);

        // Sign the certificate with SHA-256
        cert.sign(keys.privateKey, forge.md.sha256.create());

        // Convert to PEM format
        const certPem = forge.pki.certificateToPem(cert);
        const keyPem = forge.pki.privateKeyToPem(keys.privateKey);

        // Save to files
        fs.writeFileSync(certPath, certPem);
        fs.writeFileSync(keyPath, keyPem);

        // Save metadata
        fs.writeFileSync(metaPath, JSON.stringify({
            domains: [domain, `*.${domain.replace("*.", "")}`],
            expiresAt: expiresAt.toISOString(),
            issuedAt: now.toISOString(),
            selfSigned: true,
        }, null, 2));

        this.logger.info(`Self-signed certificate generated, expires: ${expiresAt.toISOString()}`);

        return {
            cert: certPem,
            key: keyPem,
            expiresAt,
            domains: [domain],
        };
    }

    /**
     * Get or generate a self-signed certificate for the given domain.
     * This is the main entry point for automatic local HTTPS.
     */
    getOrCreateSelfSignedCert(domain: string): CertificateInfo {
        return this.generateSelfSignedCertificate(domain);
    }
}
