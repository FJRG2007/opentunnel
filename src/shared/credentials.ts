import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { CloudflareCredentials, NgrokCredentials, GlobalCredentials } from "./types";

// Credentials file location
const OPENTUNNEL_DIR = path.join(os.homedir(), ".opentunnel");
const CREDENTIALS_FILE = path.join(OPENTUNNEL_DIR, "credentials.json");

/**
 * Credentials Manager
 *
 * Handles secure storage and retrieval of provider credentials.
 * Credential resolution priority: CLI > ENV > YAML > credentials.json
 */
export class CredentialsManager {
    private credentials: GlobalCredentials = {};

    constructor() {
        this.load();
    }

    /**
     * Get the credentials directory path
     */
    static getCredentialsDir(): string {
        return OPENTUNNEL_DIR;
    }

    /**
     * Get the credentials file path
     */
    static getCredentialsFile(): string {
        return CREDENTIALS_FILE;
    }

    /**
     * Ensure the credentials directory exists with secure permissions
     */
    private ensureDir(): void {
        if (!fs.existsSync(OPENTUNNEL_DIR)) {
            fs.mkdirSync(OPENTUNNEL_DIR, { recursive: true, mode: 0o700 });
        }
    }

    /**
     * Load credentials from file
     */
    load(): GlobalCredentials {
        try {
            if (fs.existsSync(CREDENTIALS_FILE)) {
                const content = fs.readFileSync(CREDENTIALS_FILE, "utf-8");
                this.credentials = JSON.parse(content);
            }
        } catch {
            this.credentials = {};
        }
        return this.credentials;
    }

    /**
     * Save credentials to file with secure permissions (0600)
     */
    save(): void {
        this.ensureDir();
        fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(this.credentials, null, 2), {
            mode: 0o600,
        });
    }

    /**
     * Get all credentials
     */
    getAll(): GlobalCredentials {
        return this.credentials;
    }

    /**
     * Get ngrok credentials
     */
    getNgrok(): NgrokCredentials | undefined {
        return this.credentials.ngrok;
    }

    /**
     * Set ngrok credentials
     */
    setNgrok(creds: NgrokCredentials): void {
        this.credentials.ngrok = creds;
        this.save();
    }

    /**
     * Remove ngrok credentials
     */
    removeNgrok(): boolean {
        if (this.credentials.ngrok) {
            delete this.credentials.ngrok;
            this.save();
            return true;
        }
        return false;
    }

    /**
     * Get Cloudflare credentials
     */
    getCloudflare(): CloudflareCredentials | undefined {
        return this.credentials.cloudflare;
    }

    /**
     * Set Cloudflare credentials
     */
    setCloudflare(creds: CloudflareCredentials): void {
        this.credentials.cloudflare = {
            ...this.credentials.cloudflare,
            ...creds,
        };
        this.save();
    }

    /**
     * Remove Cloudflare credentials
     */
    removeCloudflare(): boolean {
        if (this.credentials.cloudflare) {
            delete this.credentials.cloudflare;
            this.save();
            return true;
        }
        return false;
    }

    /**
     * Remove all credentials for a provider
     */
    removeProvider(provider: "ngrok" | "cloudflare"): boolean {
        if (provider === "ngrok") {
            return this.removeNgrok();
        } else if (provider === "cloudflare") {
            return this.removeCloudflare();
        }
        return false;
    }

    /**
     * Set a specific credential value using dot notation
     * e.g., "ngrok.token", "cloudflare.accountId"
     */
    set(key: string, value: string): void {
        const [provider, field] = key.split(".");

        if (provider === "ngrok") {
            if (!this.credentials.ngrok) {
                this.credentials.ngrok = { token: "" };
            }
            if (field === "token") {
                this.credentials.ngrok.token = value;
            }
        } else if (provider === "cloudflare") {
            if (!this.credentials.cloudflare) {
                this.credentials.cloudflare = {};
            }
            if (field === "accountId") {
                this.credentials.cloudflare.accountId = value;
            } else if (field === "tunnelToken") {
                this.credentials.cloudflare.tunnelToken = value;
            } else if (field === "certPath") {
                this.credentials.cloudflare.certPath = value;
            }
        }

        this.save();
    }

    /**
     * Get a specific credential value using dot notation
     * e.g., "ngrok.token", "cloudflare.accountId"
     */
    get(key: string): string | undefined {
        const [provider, field] = key.split(".");

        if (provider === "ngrok" && this.credentials.ngrok) {
            if (field === "token") {
                return this.credentials.ngrok.token;
            }
        } else if (provider === "cloudflare" && this.credentials.cloudflare) {
            if (field === "accountId") {
                return this.credentials.cloudflare.accountId;
            } else if (field === "tunnelToken") {
                return this.credentials.cloudflare.tunnelToken;
            } else if (field === "certPath") {
                return this.credentials.cloudflare.certPath;
            }
        }

        return undefined;
    }

    /**
     * List all stored credential keys (not values for security)
     */
    listKeys(): string[] {
        const keys: string[] = [];

        if (this.credentials.ngrok) {
            if (this.credentials.ngrok.token) keys.push("ngrok.token");
        }

        if (this.credentials.cloudflare) {
            if (this.credentials.cloudflare.accountId) keys.push("cloudflare.accountId");
            if (this.credentials.cloudflare.tunnelToken) keys.push("cloudflare.tunnelToken");
            if (this.credentials.cloudflare.certPath) keys.push("cloudflare.certPath");
        }

        return keys;
    }

    /**
     * Clear all credentials
     */
    clear(): void {
        this.credentials = {};
        this.save();
    }
}

/**
 * Resolve ngrok token with priority: CLI > ENV > YAML > credentials.json
 */
export function resolveNgrokToken(options: {
    cliToken?: string;
    yamlToken?: string;
}): string | undefined {
    // 1. CLI flag (highest priority)
    if (options.cliToken) {
        return options.cliToken;
    }

    // 2. Environment variable
    const envToken = process.env.NGROK_TOKEN || process.env.NGROK_AUTHTOKEN;
    if (envToken) {
        return envToken;
    }

    // 3. YAML config
    if (options.yamlToken) {
        return options.yamlToken;
    }

    // 4. Stored credentials (lowest priority)
    const manager = new CredentialsManager();
    return manager.getNgrok()?.token;
}

/**
 * Resolve Cloudflare credentials with priority: CLI > ENV > YAML > credentials.json
 */
export function resolveCloudflareCredentials(options: {
    cliAccountId?: string;
    cliTunnelToken?: string;
    cliCertPath?: string;
    yamlAccountId?: string;
    yamlTunnelToken?: string;
    yamlCertPath?: string;
}): CloudflareCredentials {
    const manager = new CredentialsManager();
    const stored = manager.getCloudflare() || {};

    return {
        accountId: options.cliAccountId
            || process.env.CLOUDFLARE_ACCOUNT_ID
            || options.yamlAccountId
            || stored.accountId,
        tunnelToken: options.cliTunnelToken
            || process.env.CLOUDFLARE_TUNNEL_TOKEN
            || options.yamlTunnelToken
            || stored.tunnelToken,
        certPath: options.cliCertPath
            || process.env.CLOUDFLARE_CERT_PATH
            || options.yamlCertPath
            || stored.certPath,
    };
}

// Singleton instance for convenience
let _instance: CredentialsManager | null = null;

export function getCredentialsManager(): CredentialsManager {
    if (!_instance) {
        _instance = new CredentialsManager();
    }
    return _instance;
}
