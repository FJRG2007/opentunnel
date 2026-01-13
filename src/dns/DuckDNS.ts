import https from "https";
import { DnsProvider } from "../shared/types";
import { Logger } from "../shared/utils";

export class DuckDNS implements DnsProvider {
    public name = "DuckDNS";
    private token: string;
    private logger: Logger;

    constructor(token: string) {
        this.token = token;
        this.logger = new Logger("DuckDNS");
    }

    async updateRecord(subdomain: string, ip: string): Promise<boolean> {
        return new Promise((resolve) => {
            const url = `https://www.duckdns.org/update?domains=${subdomain}&token=${this.token}&ip=${ip}`;

            https.get(url, (res) => {
                let data = "";
                res.on("data", (chunk) => (data += chunk));
                res.on("end", () => {
                    const success = data.trim() === "OK";
                    if (success) this.logger.info(`Updated ${subdomain} to ${ip}`);
                    else this.logger.error(`Failed to update ${subdomain}: ${data}`);
                    resolve(success);
                });
            }).on("error", (err) => {
                this.logger.error(`Request failed: ${err.message}`);
                resolve(false);
            });
        });
    }

    async deleteRecord(subdomain: string): Promise<boolean> {
        // DuckDNS doesn't support deleting records, just clear the IP
        return this.updateRecord(subdomain, "");
    }

    async getPublicIP(): Promise<string> {
        return new Promise((resolve, reject) => {
            https.get("https://api.ipify.org", (res) => {
                let data = "";
                res.on("data", (chunk) => (data += chunk));
                res.on("end", () => resolve(data.trim()));
            }).on("error", reject);
        });
    }
}

export class CustomDNS implements DnsProvider {
    public name = "CustomDNS";
    private apiUrl: string;
    private apiKey: string;
    private logger: Logger;

    constructor(apiUrl: string, apiKey: string) {
        this.apiUrl = apiUrl;
        this.apiKey = apiKey;
        this.logger = new Logger("CustomDNS");
    }

    async updateRecord(subdomain: string, ip: string): Promise<boolean> {
        try {
            const url = new URL(this.apiUrl);
            const postData = JSON.stringify({ subdomain, ip, apiKey: this.apiKey });

            return new Promise((resolve) => {
                const req = https.request({
                    hostname: url.hostname,
                    port: url.port || 443,
                    path: url.pathname,
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Content-Length": Buffer.byteLength(postData),
                        "Authorization": `Bearer ${this.apiKey}`,
                    },
                }, (res) => {
                    resolve(res.statusCode === 200);
                });

                req.on("error", () => resolve(false));
                req.write(postData);
                req.end();
            });
        } catch {
            return false;
        }
    }

    async deleteRecord(subdomain: string): Promise<boolean> {
        try {
            const url = new URL(this.apiUrl);

            return new Promise((resolve) => {
                const req = https.request({
                    hostname: url.hostname,
                    port: url.port || 443,
                    path: `${url.pathname}/${subdomain}`,
                    method: "DELETE",
                    headers: {
                        "Authorization": `Bearer ${this.apiKey}`,
                    },
                }, (res) => {
                    resolve(res.statusCode === 200);
                });

                req.on("error", () => resolve(false));
                req.end();
            });
        } catch {
            return false;
        }
    }
}
