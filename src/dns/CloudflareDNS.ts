import Cloudflare from "cloudflare";
import { DnsProvider } from "../shared/types";
import { Logger } from "../shared/utils";

interface CloudflareRecord {
    id: string;
    name: string;
    type: string;
    content: string;
}

export class CloudflareDNS implements DnsProvider {
    public name = "Cloudflare";
    private client: Cloudflare;
    private logger: Logger;
    private zoneId: string | null = null;
    private domain: string;
    private basePath: string;
    private serverIP: string | null = null;
    private recordCache: Map<string, string> = new Map(); // subdomain -> recordId

    constructor(apiToken: string, domain: string, basePath: string = "op") {
        this.client = new Cloudflare({ apiToken });
        this.domain = domain;
        this.basePath = basePath;
        this.logger = new Logger("CloudflareDNS");
    }

    async initialize(): Promise<boolean> {
        try {
            // Find zone ID for the domain
            this.zoneId = await this.findZoneId();
            if (!this.zoneId) {
                this.logger.error(`Zone not found for domain: ${this.domain}`);
                return false;
            }

            // Get server's public IP
            this.serverIP = await this.getPublicIP();
            this.logger.info(`Initialized for ${this.domain} (Zone: ${this.zoneId.slice(0, 8)}...)`);
            this.logger.info(`Server IP: ${this.serverIP}`);

            return true;
        } catch (err: any) {
            this.logger.error(`Initialization failed: ${err.message}`);
            return false;
        }
    }

    private async findZoneId(): Promise<string | null> {
        try {
            const zones = await this.client.zones.list();

            // Find zone that matches the domain
            for (const zone of zones.result || []) {
                if (this.domain === zone.name || this.domain.endsWith(`.${zone.name}`)) {
                    return zone.id;
                }
            }
            return null;
        } catch (err: any) {
            this.logger.error(`Failed to list zones: ${err.message}`);
            return null;
        }
    }

    async getPublicIP(): Promise<string> {
        return new Promise((resolve, reject) => {
            const https = require("https");
            https.get("https://api.ipify.org", (res: any) => {
                let data = "";
                res.on("data", (chunk: string) => (data += chunk));
                res.on("end", () => resolve(data.trim()));
            }).on("error", reject);
        });
    }

    /**
     * Create or update a DNS A record for a subdomain
     * Full record will be: subdomain.basePath.domain (e.g., myapp.op.example.com)
     */
    async updateRecord(subdomain: string, ip?: string): Promise<boolean> {
        if (!this.zoneId) {
            this.logger.error("Not initialized - call initialize() first");
            return false;
        }

        const targetIP = ip || this.serverIP;
        if (!targetIP) {
            this.logger.error("No IP address available");
            return false;
        }

        // Full record name: subdomain.op.domain.com
        const recordName = `${subdomain}.${this.basePath}.${this.domain}`;

        try {
            // Check if record already exists
            const existingRecord = await this.findRecord(recordName);

            if (existingRecord) {
                // Update existing record
                if (existingRecord.content === targetIP) {
                    this.logger.info(`Record ${recordName} already points to ${targetIP}`);
                    return true;
                }

                await this.client.dns.records.update(existingRecord.id, {
                    zone_id: this.zoneId,
                    type: "A",
                    name: recordName,
                    content: targetIP,
                    ttl: 60, // 1 minute TTL for quick updates
                    proxied: false,
                });
                this.logger.info(`Updated ${recordName} -> ${targetIP}`);
            } else {
                // Create new record
                const result = await this.client.dns.records.create({
                    zone_id: this.zoneId,
                    type: "A",
                    name: recordName,
                    content: targetIP,
                    ttl: 60,
                    proxied: false,
                });
                this.recordCache.set(subdomain, result.id);
                this.logger.info(`Created ${recordName} -> ${targetIP}`);
            }

            return true;
        } catch (err: any) {
            this.logger.error(`Failed to update record ${recordName}: ${err.message}`);
            return false;
        }
    }

    /**
     * Delete a DNS record for a subdomain
     */
    async deleteRecord(subdomain: string): Promise<boolean> {
        if (!this.zoneId) {
            this.logger.error("Not initialized - call initialize() first");
            return false;
        }

        const recordName = `${subdomain}.${this.basePath}.${this.domain}`;

        try {
            const existingRecord = await this.findRecord(recordName);

            if (!existingRecord) {
                this.logger.info(`Record ${recordName} does not exist`);
                return true;
            }

            await this.client.dns.records.delete(existingRecord.id, {
                zone_id: this.zoneId,
            });

            this.recordCache.delete(subdomain);
            this.logger.info(`Deleted ${recordName}`);
            return true;
        } catch (err: any) {
            this.logger.error(`Failed to delete record ${recordName}: ${err.message}`);
            return false;
        }
    }

    /**
     * Find an existing DNS record by name
     */
    private async findRecord(name: string): Promise<CloudflareRecord | null> {
        if (!this.zoneId) return null;

        try {
            const records = await this.client.dns.records.list({
                zone_id: this.zoneId,
                name: { exact: name },
                type: "A",
            });

            if (records.result && records.result.length > 0) {
                const record = records.result[0];
                return {
                    id: record.id,
                    name: record.name,
                    type: record.type,
                    content: record.content as string,
                };
            }
            return null;
        } catch {
            return null;
        }
    }

    /**
     * Ensure wildcard record exists (*.op.domain.com)
     * This is a fallback for subdomains not explicitly created
     */
    async ensureWildcardRecord(): Promise<boolean> {
        if (!this.zoneId || !this.serverIP) {
            return false;
        }

        const wildcardName = `*.${this.basePath}.${this.domain}`;

        try {
            const existingRecord = await this.findRecord(wildcardName);

            if (existingRecord) {
                if (existingRecord.content === this.serverIP) {
                    this.logger.info(`Wildcard record already exists: ${wildcardName}`);
                    return true;
                }
                // Update to current IP
                await this.client.dns.records.update(existingRecord.id, {
                    zone_id: this.zoneId,
                    type: "A",
                    name: wildcardName,
                    content: this.serverIP,
                    ttl: 300,
                    proxied: false,
                });
                this.logger.info(`Updated wildcard record: ${wildcardName} -> ${this.serverIP}`);
            } else {
                await this.client.dns.records.create({
                    zone_id: this.zoneId,
                    type: "A",
                    name: wildcardName,
                    content: this.serverIP,
                    ttl: 300,
                    proxied: false,
                });
                this.logger.info(`Created wildcard record: ${wildcardName} -> ${this.serverIP}`);
            }

            return true;
        } catch (err: any) {
            this.logger.error(`Failed to create wildcard record: ${err.message}`);
            return false;
        }
    }

    /**
     * Ensure base domain record exists (op.domain.com)
     */
    async ensureBaseRecord(): Promise<boolean> {
        if (!this.zoneId || !this.serverIP) {
            return false;
        }

        const baseName = `${this.basePath}.${this.domain}`;

        try {
            const existingRecord = await this.findRecord(baseName);

            if (existingRecord) {
                if (existingRecord.content === this.serverIP) {
                    this.logger.info(`Base record already exists: ${baseName}`);
                    return true;
                }
                await this.client.dns.records.update(existingRecord.id, {
                    zone_id: this.zoneId,
                    type: "A",
                    name: baseName,
                    content: this.serverIP,
                    ttl: 300,
                    proxied: false,
                });
                this.logger.info(`Updated base record: ${baseName} -> ${this.serverIP}`);
            } else {
                await this.client.dns.records.create({
                    zone_id: this.zoneId,
                    type: "A",
                    name: baseName,
                    content: this.serverIP,
                    ttl: 300,
                    proxied: false,
                });
                this.logger.info(`Created base record: ${baseName} -> ${this.serverIP}`);
            }

            return true;
        } catch (err: any) {
            this.logger.error(`Failed to create base record: ${err.message}`);
            return false;
        }
    }

    /**
     * Setup all necessary DNS records for the tunnel server
     * Creates: op.domain.com and *.op.domain.com
     */
    async setupDNS(): Promise<boolean> {
        this.logger.info("Setting up DNS records...");

        const baseSuccess = await this.ensureBaseRecord();
        const wildcardSuccess = await this.ensureWildcardRecord();

        if (baseSuccess && wildcardSuccess) {
            this.logger.info("DNS setup complete!");
            this.logger.info(`  Base:     ${this.basePath}.${this.domain}`);
            this.logger.info(`  Wildcard: *.${this.basePath}.${this.domain}`);
            return true;
        }

        return false;
    }

    getZoneId(): string | null {
        return this.zoneId;
    }

    getServerIP(): string | null {
        return this.serverIP;
    }
}
