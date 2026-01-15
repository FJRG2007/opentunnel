#!/usr/bin/env node
import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { TunnelClient } from "../client/TunnelClient";
import { NgrokClient } from "../client/NgrokClient";
import { TunnelProtocol } from "../shared/types";
import { formatBytes, formatDuration } from "../shared/utils";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import * as fs from "fs";
import * as path from "path";


// Config file interfaces
interface TunnelConfigYaml {
    name: string;
    protocol: "http" | "https" | "tcp";
    port: number;
    host?: string;
    subdomain?: string;
    remotePort?: number;
    autostart?: boolean;
}

// Mode determines how OpenTunnel operates
// - "server": Run as a tunnel server (accepts connections from clients)
// - "client": Connect to a remote server and expose local ports
// - "hybrid": Run server AND expose local ports in the same terminal
type OpenTunnelMode = "server" | "client" | "hybrid";

// Domain configuration for multi-domain support
interface DomainConfig {
    domain: string;
    basePath?: string;  // Default: "op"
    wildcard?: boolean; // Default: true (auto-detected false for DuckDNS domains)
}

interface OpenTunnelConfig {
    name?: string;                 // Instance name (shown in ps, used for pid/log files)
    mode?: OpenTunnelMode;         // Explicitly set the mode (auto-detected if not set)
    server?: {
        domain?: string;   // Single domain (backward compatible)
        domains?: (string | DomainConfig)[];  // Multiple domains
        remote?: string;   // Connect to remote server (e.g., "op.fjrg2007.com")
        port?: number;
        basePath?: string; // Default basePath for single domain mode
        https?: boolean;
        token?: string;
        tcpPortMin?: number;
        tcpPortMax?: number;
        dymo?: {
            apiKey: string;
            verifyIp?: boolean;
            verifyUserAgent?: boolean;
            blockOnFraud?: boolean;
            blockBots?: boolean;
            blockProxies?: boolean;
            blockHosting?: boolean;
            cacheResults?: boolean;
            cacheTTL?: number;
        };
        ipAccess?: {
            mode: "all" | "allowlist" | "denylist";
            allowList?: string[];
            denyList?: string[];
        };
    };
    tunnels?: TunnelConfigYaml[];  // Optional: not needed for server-only mode
}

const CONFIG_FILE = "opentunnel.yml";

// Global registry for tracking all running instances
interface InstanceInfo {
    name: string;
    pid: number;
    configPath: string;
    logFile: string;
    pidFile: string;
    cwd: string;
    startedAt: string;
}

interface GlobalRegistry {
    instances: InstanceInfo[];
}

function getRegistryPath(): string {
    const os = require("os");
    const path = require("path");
    const registryDir = path.join(os.homedir(), ".opentunnel");
    return path.join(registryDir, "registry.json");
}

function getLogsDir(): string {
    const os = require("os");
    const path = require("path");
    const fs = require("fs");
    const logsDir = path.join(os.homedir(), ".opentunnel", "logs");

    // Ensure directory exists
    if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
    }

    return logsDir;
}

function getLogFilePath(instanceName: string): string {
    const path = require("path");
    // Sanitize instance name for filename
    const safeName = instanceName.replace(/[^a-zA-Z0-9_-]/g, "_");
    return path.join(getLogsDir(), `${safeName}.log`);
}

function getPidFilePath(instanceName: string): string {
    const path = require("path");
    const safeName = instanceName.replace(/[^a-zA-Z0-9_-]/g, "_");
    return path.join(getLogsDir(), `${safeName}.pid`);
}

function loadRegistry(): GlobalRegistry {
    const fs = require("fs");
    const path = require("path");
    const registryPath = getRegistryPath();

    try {
        // Ensure directory exists
        const dir = path.dirname(registryPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        if (fs.existsSync(registryPath)) {
            return JSON.parse(fs.readFileSync(registryPath, "utf-8"));
        }
    } catch {}

    return { instances: [] };
}

function saveRegistry(registry: GlobalRegistry): void {
    const fs = require("fs");
    const path = require("path");
    const registryPath = getRegistryPath();

    // Ensure directory exists
    const dir = path.dirname(registryPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
}

function registerInstance(info: InstanceInfo): void {
    const registry = loadRegistry();
    // Remove any existing entry with same name and cwd
    registry.instances = registry.instances.filter(
        i => !(i.name === info.name && i.cwd === info.cwd)
    );
    registry.instances.push(info);
    saveRegistry(registry);
}

function unregisterInstance(name: string, cwd: string): void {
    const registry = loadRegistry();
    registry.instances = registry.instances.filter(
        i => !(i.name === name && i.cwd === cwd)
    );
    saveRegistry(registry);
}

function unregisterInstanceByPid(pid: number): void {
    const registry = loadRegistry();
    registry.instances = registry.instances.filter(i => i.pid !== pid);
    saveRegistry(registry);
}

// Global CLI configuration
interface CLIConfig {
    defaultDomain?: {
        domain: string;
        basePath?: string;
    };
}

function getConfigPath(): string {
    const os = require("os");
    const configDir = path.join(os.homedir(), ".opentunnel");
    return path.join(configDir, "config.json");
}

function loadCLIConfig(): CLIConfig {
    const configPath = getConfigPath();
    try {
        if (fs.existsSync(configPath)) {
            return JSON.parse(fs.readFileSync(configPath, "utf-8"));
        }
    } catch {}
    return {};
}

function saveCLIConfig(config: CLIConfig): void {
    const configPath = getConfigPath();
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

function getDefaultDomain(): { domain: string; basePath?: string } | null {
    const config = loadCLIConfig();
    return config.defaultDomain || null;
}

function setDefaultDomain(domain: string, basePath?: string): void {
    const config = loadCLIConfig();
    config.defaultDomain = { domain };
    if (basePath) config.defaultDomain.basePath = basePath;
    saveCLIConfig(config);
}

function clearDefaultDomain(): boolean {
    const config = loadCLIConfig();
    if (config.defaultDomain) {
        delete config.defaultDomain;
        saveCLIConfig(config);
        return true;
    }
    return false;
}

// Load .env file if exists
function loadEnvFile(): void {
    const envPath = path.join(process.cwd(), ".env");
    if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, "utf-8");
        for (const line of envContent.split("\n")) {
            const trimmed = line.trim();
            // Skip comments and empty lines
            if (!trimmed || trimmed.startsWith("#")) continue;

            const match = trimmed.match(/^([^=]+)=(.*)$/);
            if (match) {
                const key = match[1].trim();
                let value = match[2].trim();
                // Remove surrounding quotes if present
                if ((value.startsWith('"') && value.endsWith('"')) ||
                    (value.startsWith("'") && value.endsWith("'"))) {
                    value = value.slice(1, -1);
                }
                // Only set if not already defined in environment
                if (process.env[key] === undefined) process.env[key] = value;
            }
        }
    }
};

// Docker-style environment variable substitution
// Supports: ${VAR}, ${VAR:-default}, ${VAR:=default}
function substituteEnvVars(content: string): string {
    // Pattern matches ${VAR}, ${VAR:-default}, ${VAR:=default}
    const pattern = /\$\{([^}:]+)(?:(:[-=])([^}]*))?\}/g;

    return content.replace(pattern, (match, varName, operator, defaultValue) => {
        const envValue = process.env[varName];

        if (operator === ":-" || operator === ":=") return (envValue !== undefined && envValue !== "") ? envValue : (defaultValue || "");

        // Just ${VAR} - return value or empty string
        return envValue || "";
    });
};

// Load and parse config file with environment variable substitution
function loadConfig(configPath: string): OpenTunnelConfig | null {
    if (!fs.existsSync(configPath)) return null;

    // Load .env file first
    loadEnvFile();

    // Read and substitute environment variables
    let content = fs.readFileSync(configPath, "utf-8");
    content = substituteEnvVars(content);

    return parseYaml(content) as OpenTunnelConfig;
};

const program = new Command();

program
    .name("opentunnel")
    .alias("ot")
    .description("Expose local ports to the internet via custom domains or ngrok")
    .version("1.0.23");

// Helper function to build WebSocket URL from domain
// User only provides base domain (e.g., fjrg2007.com), system handles the rest
// Note: --insecure flag only affects certificate verification, not the protocol
function buildServerUrl(server: string, basePath?: string): { url: string; displayName: string } {
    let hostname = server;

    // Remove protocol if provided
    hostname = hostname.replace(/^(wss?|https?):\/\//, "");
    // Remove trailing path
    hostname = hostname.replace(/\/_tunnel.*$/, "");
    // Remove trailing slash
    hostname = hostname.replace(/\/$/, "");

    // Build the full hostname with basePath if provided and not empty
    // If basePath is "op" (default), connect to op.domain.com
    // If basePath is empty or not provided, connect directly to domain.com
    const effectiveBasePath = basePath || "op";
    const fullHostname = effectiveBasePath ? `${effectiveBasePath}.${hostname}` : hostname;

    // Always use wss:// for remote servers (--insecure only skips cert verification)
    return {
        url: `wss://${fullHostname}/_tunnel`,
        displayName: hostname,
    };
}

// Quick command - quick tunnel to any server
program
    .command("quick <port>")
    .description("Instantly expose a local port to the internet")
    .option("-s, --domain <domain>", "Server domain (e.g., example.com)")
    .option("-b, --base-path <path>", "Server base path (default: op)")
    .option("-n, --subdomain <name>", "Request a specific subdomain (e.g., 'myapp')")
    .option("-p, --protocol <proto>", "Protocol (http, https, tcp)", "http")
    .option("-h, --host <host>", "Local host to forward to", "localhost")
    .option("-t, --token <token>", "Authentication token (if server requires it)")
    .option("--insecure", "Skip SSL certificate verification (for self-signed certs)")
    .option("--local-server", "Start a local server before connecting")
    .option("--server-port <port>", "Port for the local server (default: 443)", "443")
    .action(async (port: string, options) => {
        // If --local-server flag is used, start a local server first
        let localServer: any = null;
        let serverUrl: string;
        let serverDisplayName: string;

        if (options.localServer) {
            // Get domain from options or default config
            let domain = options.domain;
            let basePath = options.basePath;

            if (!domain) {
                const defaultConfig = getDefaultDomain();
                if (defaultConfig) {
                    domain = defaultConfig.domain;
                    if (!basePath && defaultConfig.basePath) {
                        basePath = defaultConfig.basePath;
                    }
                }
            }

            if (!domain) {
                console.log(chalk.red("Error: No domain specified and no default domain configured"));
                console.log(chalk.gray("\nOptions:"));
                console.log(chalk.cyan("  1. Specify domain: opentunnel quick 3000 --local-server -s example.com"));
                console.log(chalk.cyan("  2. Set default:    opentunnel setdomain example.com"));
                process.exit(1);
            }

            const { TunnelServer } = await import("../server/TunnelServer");
            const serverPort = parseInt(options.serverPort);

            console.log(chalk.cyan(`\nStarting local server on port ${serverPort}...`));

            localServer = new TunnelServer({
                port: serverPort,
                host: "0.0.0.0",
                domain: domain,
                basePath: basePath || "op",
                tunnelPortRange: { min: 10000, max: 20000 },
                selfSignedHttps: { enabled: true },
                auth: options.token ? { required: true, tokens: [options.token] } : undefined,
            });

            try {
                await localServer.start();
                console.log(chalk.green(`✓ Server running on port ${serverPort}\n`));
            } catch (err: any) {
                console.log(chalk.red(`Failed to start server: ${err.message}`));
                process.exit(1);
            }

            // Connect to local server
            serverUrl = `wss://localhost:${serverPort}/_tunnel`;
            serverDisplayName = domain;
            options.insecure = true; // Local server uses self-signed cert
        } else {
            if (!options.domain) {
                console.log(chalk.red("Error: -s, --domain <domain> is required"));
                console.log(chalk.gray("\nExamples:"));
                console.log(chalk.cyan("  opentunnel quick 3000 -s example.com"));
                console.log(chalk.cyan("  opentunnel quick 3000 --domain yourdomain.com --local-server"));
                process.exit(1);
            }
            // Build server URL from domain (user provides domain, system adds basePath)
            const result = buildServerUrl(options.domain, options.basePath);
            serverUrl = result.url;
            serverDisplayName = result.displayName;
        }

        console.log(chalk.cyan(`
 ██████╗ ██████╗ ███████╗███╗   ██╗████████╗██╗   ██╗███╗   ██╗███╗   ██╗███████╗██╗
██╔═══██╗██╔══██╗██╔════╝████╗  ██║╚══██╔══╝██║   ██║████╗  ██║████╗  ██║██╔════╝██║
██║   ██║██████╔╝█████╗  ██╔██╗ ██║   ██║   ██║   ██║██╔██╗ ██║██╔██╗ ██║█████╗  ██║
██║   ██║██╔═══╝ ██╔══╝  ██║╚██╗██║   ██║   ██║   ██║██║╚██╗██║██║╚██╗██║██╔══╝  ██║
╚██████╔╝██║     ███████╗██║ ╚████║   ██║   ╚██████╔╝██║ ╚████║██║ ╚████║███████╗███████╗
 ╚═════╝ ╚═╝     ╚══════╝╚═╝  ╚═══╝   ╚═╝    ╚═════╝ ╚═╝  ╚═══╝╚═╝  ╚═══╝╚══════╝╚══════╝
`));
        console.log(chalk.gray(`  Connecting to ${serverDisplayName}...\n`));

        const spinner = ora("Connecting to server...").start();

        // Helper to check if error is SSL-related
        const isSslError = (err: any) =>
            err.message?.includes("SELF_SIGNED_CERT") ||
            err.message?.includes("CERT_") ||
            err.message?.includes("certificate") ||
            err.code === "DEPTH_ZERO_SELF_SIGNED_CERT" ||
            err.code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE";

        // Helper to connect and create tunnel
        const connectAndCreateTunnel = async (insecure: boolean) => {
            const client = new TunnelClient({
                serverUrl,
                token: options.token,
                reconnect: true,
                silent: true,
                rejectUnauthorized: !insecure
            });

            await client.connect();
            spinner.text = "Creating tunnel...";

            const { tunnelId, publicUrl } = await client.createTunnel({
                protocol: options.protocol as TunnelProtocol,
                localHost: options.host,
                localPort: parseInt(port),
                subdomain: options.subdomain,
            });

            return { client, tunnelId, publicUrl };
        };

        try {
            let client: TunnelClient;
            let tunnelId: string;
            let publicUrl: string;
            let usedInsecure = options.insecure || false;

            try {
                // First attempt with user's preference
                const result = await connectAndCreateTunnel(options.insecure || false);
                client = result.client;
                tunnelId = result.tunnelId;
                publicUrl = result.publicUrl;
            } catch (firstErr: any) {
                // If SSL error and not already using insecure, retry with insecure
                if (isSslError(firstErr) && !options.insecure) {
                    spinner.text = "Retrying with insecure mode...";
                    const result = await connectAndCreateTunnel(true);
                    client = result.client;
                    tunnelId = result.tunnelId;
                    publicUrl = result.publicUrl;
                    usedInsecure = true;
                } else throw firstErr;
            }

            spinner.succeed("Tunnel established!");

            console.log("");
            console.log(chalk.cyan(`  OpenTunnel ${chalk.gray(`(via ${serverDisplayName})`)}`));
            console.log(chalk.gray("  ─────────────────────────────────────────"));
            console.log(`  ${chalk.white("Status:")}    ${chalk.green("● Online")}`);
            if (usedInsecure && !options.insecure) console.log(`  ${chalk.white("Security:")} ${chalk.yellow("⚠ Insecure (self-signed cert)")}`);
            console.log(`  ${chalk.white("Protocol:")}  ${chalk.yellow(options.protocol.toUpperCase())}`);
            console.log(`  ${chalk.white("Local:")}     ${chalk.gray(`${options.host}:${port}`)}`);
            console.log(`  ${chalk.white("Public:")}    ${chalk.green(publicUrl)}`);
            console.log(chalk.gray("  ─────────────────────────────────────────"));
            console.log("");
            console.log(chalk.gray("  Press Ctrl+C to close the tunnel"));
            console.log("");

            // Keep alive with uptime counter
            const startTime = Date.now();
            const statsInterval = setInterval(() => {
                const uptime = formatDuration(Date.now() - startTime);
                process.stdout.write(`\r  ${chalk.gray(`Uptime: ${uptime}`)}`);
            }, 1000);

            // Handle exit
            const cleanup = async () => {
                clearInterval(statsInterval);
                console.log("\n");
                const closeSpinner = ora("Closing tunnel...").start();
                await client.closeTunnel(tunnelId);
                await client.disconnect();
                closeSpinner.succeed("Tunnel closed");
                process.exit(0);
            };

            process.on("SIGINT", cleanup);
            process.on("SIGTERM", cleanup);

            // Handle reconnection
            client.on("disconnected", () => {
                console.log(chalk.yellow("\n  Disconnected, reconnecting..."));
            });

            client.on("connected", () => {
                console.log(chalk.green("  Reconnected!"));
            });

        } catch (err: any) {
            spinner.fail(`Failed: ${err.message}`);
            console.log("");
            console.log(chalk.yellow("  Troubleshooting:"));
            console.log(chalk.gray("  - Check your internet connection"));
            console.log(chalk.gray("  - Verify the server domain is correct"));
            console.log(chalk.gray("  - Make sure the server is running"));
            console.log("");
            process.exit(1);
        }
    });

// Domain management commands
program
    .command("setdomain <domain>")
    .description("Set a default domain for quick tunnels")
    .option("-b, --base-path <path>", "Server base path (default: op)")
    .action((domain: string, options) => {
        setDefaultDomain(domain, options.basePath);
        console.log(chalk.green(`\n  Default domain set to: ${chalk.cyan(domain)}`));
        if (options.basePath) {
            console.log(chalk.gray(`  Base path: ${options.basePath}`));
        }
        console.log(chalk.gray(`\n  Now you can use 'opentunnel expl <port>' without specifying -s\n`));
    });

program
    .command("getdomain")
    .description("Show the default domain configuration")
    .action(() => {
        const config = getDefaultDomain();
        if (config) {
            console.log(chalk.cyan("\n  Default Domain Configuration"));
            console.log(chalk.gray("  ─────────────────────────────"));
            console.log(`  ${chalk.white("Domain:")}    ${chalk.green(config.domain)}`);
            if (config.basePath) {
                console.log(`  ${chalk.white("Base Path:")} ${chalk.gray(config.basePath)}`);
            }
            console.log("");
        } else {
            console.log(chalk.yellow("\n  No default domain configured"));
            console.log(chalk.gray("  Use 'opentunnel setdomain <domain>' to set one\n"));
        }
    });

program
    .command("cleardomain")
    .description("Remove the default domain configuration")
    .action(() => {
        if (clearDefaultDomain()) {
            console.log(chalk.green("\n  Default domain configuration removed\n"));
        } else {
            console.log(chalk.yellow("\n  No default domain was configured\n"));
        }
    });

// Expose Local Server command (shortcut for quick --local-server)
program
    .command("expl <port>")
    .description("Expose local port via local server (shortcut for 'quick <port> --local-server')")
    .option("-s, --domain <domain>", "Server domain (uses default if not specified)")
    .option("-b, --base-path <path>", "Server base path (default: op)")
    .option("-n, --subdomain <name>", "Request a specific subdomain (e.g., 'myapp')")
    .option("-p, --protocol <proto>", "Protocol (http, https, tcp)", "http")
    .option("-h, --host <host>", "Local host to forward to", "localhost")
    .option("-t, --token <token>", "Authentication token (if server requires it)")
    .option("--insecure", "Skip SSL certificate verification (for self-signed certs)")
    .option("--server-port <port>", "Port for the local server (default: 443)", "443")
    .action(async (port: string, options) => {
        // Get domain from options or default config
        let domain = options.domain;
        let basePath = options.basePath;

        if (!domain) {
            const defaultConfig = getDefaultDomain();
            if (defaultConfig) {
                domain = defaultConfig.domain;
                if (!basePath && defaultConfig.basePath) {
                    basePath = defaultConfig.basePath;
                }
            }
        }

        if (!domain) {
            console.log(chalk.red("Error: No domain specified and no default domain configured"));
            console.log(chalk.gray("\nOptions:"));
            console.log(chalk.cyan("  1. Specify domain: opentunnel expl 3000 -s example.com"));
            console.log(chalk.cyan("  2. Set default:    opentunnel setdomain example.com"));
            process.exit(1);
        }

        const { TunnelServer } = await import("../server/TunnelServer");
        const serverPort = parseInt(options.serverPort);

        console.log(chalk.cyan(`
 ██████╗ ██████╗ ███████╗███╗   ██╗████████╗██╗   ██╗███╗   ██╗███╗   ██╗███████╗██╗
██╔═══██╗██╔══██╗██╔════╝████╗  ██║╚══██╔══╝██║   ██║████╗  ██║████╗  ██║██╔════╝██║
██║   ██║██████╔╝█████╗  ██╔██╗ ██║   ██║   ██║   ██║██╔██╗ ██║██╔██╗ ██║█████╗  ██║
██║   ██║██╔═══╝ ██╔══╝  ██║╚██╗██║   ██║   ██║   ██║██║╚██╗██║██║╚██╗██║██╔══╝  ██║
╚██████╔╝██║     ███████╗██║ ╚████║   ██║   ╚██████╔╝██║ ╚████║██║ ╚████║███████╗███████╗
 ╚═════╝ ╚═╝     ╚══════╝╚═╝  ╚═══╝   ╚═╝    ╚═════╝ ╚═╝  ╚═══╝╚═╝  ╚═══╝╚══════╝╚══════╝
`));
        console.log(chalk.gray(`  Starting local server on port ${serverPort}...\n`));

        let localServer: any;
        try {
            localServer = new TunnelServer({
                port: serverPort,
                host: "0.0.0.0",
                domain: domain,
                basePath: basePath || "op",
                tunnelPortRange: { min: 10000, max: 20000 },
                selfSignedHttps: { enabled: true },
                auth: options.token ? { required: true, tokens: [options.token] } : undefined,
            });

            await localServer.start();
            console.log(chalk.green(`  Server running on port ${serverPort}\n`));
        } catch (err: any) {
            console.log(chalk.red(`Failed to start server: ${err.message}`));
            process.exit(1);
        }

        // Connect to local server
        const serverUrl = `wss://localhost:${serverPort}/_tunnel`;
        const spinner = ora("Connecting to local server...").start();

        try {
            const client = new TunnelClient({
                serverUrl,
                token: options.token,
                reconnect: true,
                silent: true,
                rejectUnauthorized: false // Local server uses self-signed cert
            });

            await client.connect();
            spinner.text = "Creating tunnel...";

            const { tunnelId, publicUrl } = await client.createTunnel({
                protocol: options.protocol as TunnelProtocol,
                localHost: options.host,
                localPort: parseInt(port),
                subdomain: options.subdomain,
            });

            spinner.succeed("Tunnel established!");

            console.log("");
            console.log(chalk.cyan(`  OpenTunnel ${chalk.gray(`(local server → ${domain})`)}`));
            console.log(chalk.gray("  ─────────────────────────────────────────"));
            console.log(`  ${chalk.white("Status:")}    ${chalk.green("● Online")}`);
            console.log(`  ${chalk.white("Protocol:")}  ${chalk.yellow(options.protocol.toUpperCase())}`);
            console.log(`  ${chalk.white("Local:")}     ${chalk.gray(`${options.host}:${port}`)}`);
            console.log(`  ${chalk.white("Public:")}    ${chalk.green(publicUrl)}`);
            console.log(chalk.gray("  ─────────────────────────────────────────"));
            console.log("");
            console.log(chalk.gray("  Press Ctrl+C to close the tunnel"));
            console.log("");

            // Keep alive with uptime counter
            const startTime = Date.now();
            const statsInterval = setInterval(() => {
                const uptime = formatDuration(Date.now() - startTime);
                process.stdout.write(`\r  ${chalk.gray(`Uptime: ${uptime}`)}`);
            }, 1000);

            // Handle exit
            const cleanup = async () => {
                clearInterval(statsInterval);
                console.log("\n");
                const closeSpinner = ora("Closing tunnel...").start();
                await client.closeTunnel(tunnelId);
                await client.disconnect();
                if (localServer) {
                    await localServer.stop();
                }
                closeSpinner.succeed("Tunnel closed");
                process.exit(0);
            };

            process.on("SIGINT", cleanup);
            process.on("SIGTERM", cleanup);

            // Handle reconnection
            client.on("disconnected", () => {
                console.log(chalk.yellow("\n  Disconnected, reconnecting..."));
            });

            client.on("connected", () => {
                console.log(chalk.green("  Reconnected!"));
            });

        } catch (err: any) {
            spinner.fail(`Failed: ${err.message}`);
            if (localServer) {
                await localServer.stop();
            }
            process.exit(1);
        }
    });

// HTTP tunnel command
program
    .command("http <port>")
    .description("Expose a local HTTP server")
    .option("-s, --domain <domain>", "Remote server domain (if not provided, starts local server)")
    .option("-b, --base-path <path>", "Server base path (default: op)")
    .option("-t, --token <token>", "Authentication token")
    .option("-n, --subdomain <name>", "Custom subdomain (e.g., 'myapp' for myapp.op.domain.com)")
    .option("-d, --detach", "Run tunnel in background")
    .option("-h, --host <host>", "Local host", "localhost")
    .option("--server-port <port>", "Server port", "443")
    .option("--https", "Use HTTPS for local connection")
    .option("--insecure", "Skip SSL verification (for self-signed certs)")
    .option("--ngrok", "Use ngrok instead of OpenTunnel server")
    .option("--region <region>", "Ngrok region (us, eu, ap, au, sa, jp, in)", "us")
    .action(async (port: string, options) => {
        if (options.ngrok || options.domain === "ngrok") {
            await createNgrokTunnel({
                protocol: options.https ? "https" : "http",
                localHost: options.host,
                localPort: parseInt(port),
                subdomain: options.subdomain,
                authtoken: options.token,
                region: options.region,
            });
            return;
        }

        // If remote server domain provided, just connect to it
        if (options.domain) {
            const { url: serverUrl } = buildServerUrl(options.domain, options.basePath);
            await createTunnel({
                protocol: options.https ? "https" : "http",
                localHost: options.host,
                localPort: parseInt(port),
                subdomain: options.subdomain,
                serverUrl,
                token: options.token,
                insecure: options.insecure,
            });
            return;
        }

        // No domain provided - show error
        console.log(chalk.red("Error: -s, --domain <domain> is required"));
        console.log(chalk.gray("\nExamples:"));
        console.log(chalk.cyan("  opentunnel http 3000 -s example.com"));
        console.log(chalk.cyan("  opentunnel http 3000 --domain example.com -n myapp"));
        process.exit(1);
    });

// TCP tunnel command
program
    .command("tcp <port>")
    .description("Expose a local TCP server")
    .option("-s, --domain <domain>", "Remote server domain")
    .option("-b, --base-path <path>", "Server base path (default: op)")
    .option("-t, --token <token>", "Authentication token")
    .option("-r, --remote-port <port>", "Remote port to use")
    .option("-n, --subdomain <name>", "Custom subdomain")
    .option("-h, --host <host>", "Local host", "localhost")
    .option("--insecure", "Skip SSL verification (for self-signed certs)")
    .option("--ngrok", "Use ngrok instead of OpenTunnel server")
    .option("--region <region>", "Ngrok region (us, eu, ap, au, sa, jp, in)", "us")
    .action(async (port: string, options) => {
        if (options.ngrok || options.domain === "ngrok") {
            await createNgrokTunnel({
                protocol: "tcp",
                localHost: options.host,
                localPort: parseInt(port),
                remotePort: options.remotePort ? parseInt(options.remotePort) : undefined,
                authtoken: options.token,
                region: options.region
            });
            return;
        }

        // If remote server domain provided, just connect to it
        if (options.domain) {
            const { url: serverUrl } = buildServerUrl(options.domain, options.basePath);
            await createTunnel({
                protocol: "tcp",
                localHost: options.host,
                localPort: parseInt(port),
                remotePort: options.remotePort ? parseInt(options.remotePort) : undefined,
                serverUrl,
                token: options.token,
                insecure: options.insecure
            });
            return;
        }

        // No domain provided - show error
        console.log(chalk.red("Error: -s, --domain <domain> is required"));
        console.log(chalk.gray("\nExamples:"));
        console.log(chalk.cyan("  opentunnel tcp 5432 -s example.com"));
        console.log(chalk.cyan("  opentunnel tcp 5432 --domain example.com -r 15432"));
        process.exit(1);
    });

// Quick expose command
program
    .command("expose <port>")
    .description("Quick expose a local port (auto-detects HTTP)")
    .option("-s, --server <url>", "Server URL")
    .option("-t, --token <token>", "Authentication token")
    .option("-n, --subdomain <name>", "Custom subdomain")
    .option("-d, --detach", "Run tunnel in background")
    .option("-p, --protocol <proto>", "Protocol (http, https, tcp)", "http")
    .option("--domain <domain>", "Server domain (e.g., domain.com)")
    .option("--insecure", "Skip SSL certificate verification (for self-signed certs)")
    .option("--ngrok", "Use ngrok instead of OpenTunnel server")
    .action(async (port: string, options) => {
        const serverUrl = options.server || (options.domain
            ? `wss://${options.domain}/_tunnel`
            : "ws://localhost:8080/_tunnel");

        if (options.detach) {
            await runTunnelInBackground("expose", port, { ...options, server: serverUrl });
            return;
        }
        if (options.ngrok || options.server === "ngrok") {
            await createNgrokTunnel({
                protocol: options.protocol as TunnelProtocol,
                localHost: "localhost",
                localPort: parseInt(port),
                subdomain: options.subdomain,
                authtoken: options.token
            });
        } else {
            await createTunnel({
                protocol: options.protocol as TunnelProtocol,
                localHost: "localhost",
                localPort: parseInt(port),
                subdomain: options.subdomain,
                serverUrl,
                token: options.token,
                insecure: options.insecure
            });
        }
    });

// Server command
program
    .command("server")
    .description("Start the OpenTunnel server (standalone mode)")
    .option("-p, --port <port>", "Server port")
    .option("--public-port <port>", "Public port shown in URLs (default: same as port)")
    .option("--domain <domain>", "Base domain")
    .option("-b, --base-path <path>", "Subdomain base path (e.g., 'op' for *.op.domain.com)")
    .option("--host <host>", "Bind host")
    .option("--tcp-min <port>", "Minimum TCP port")
    .option("--tcp-max <port>", "Maximum TCP port")
    .option("--auth-tokens <tokens>", "Comma-separated auth tokens")
    .option("--no-https", "Disable HTTPS (use plain HTTP)")
    .option("--https-cert <path>", "Path to SSL certificate (for custom certs)")
    .option("--https-key <path>", "Path to SSL private key (for custom certs)")
    .option("--letsencrypt", "Use Let's Encrypt instead of self-signed (requires port 80)")
    .option("--email <email>", "Email for Let's Encrypt notifications")
    .option("--production", "Use Let's Encrypt production (default: staging)")
    .option("--cloudflare-token <token>", "Cloudflare API token for DNS-01 challenge")
    .option("--duckdns-token <token>", "DuckDNS token for dynamic DNS updates")
    .option("--ip-mode <mode>", "IP access mode: all, allowlist, denylist (default: all)")
    .option("--ip-allow <ips>", "Comma-separated IPs/CIDRs to allow (e.g., 192.168.1.0/24,10.0.0.1)")
    .option("--ip-deny <ips>", "Comma-separated IPs/CIDRs to deny")
    .option("--dymo-api-key <key>", "Dymo API key for fraud detection (optional)")
    .option("--no-dymo-block-bots", "Allow bot user agents (blocked by default when Dymo enabled)")
    .option("--dymo-block-proxies", "Block proxy/VPN IPs")
    .option("--dymo-block-hosting", "Block hosting/datacenter IPs")
    .option("--no-dymo-cache", "Disable Dymo verification caching (sends API request for every HTTP request)")
    .option("--dymo-cache-ttl <seconds>", "Dymo cache TTL in seconds (default: 300)")
    .option("-d, --detach", "Run server in background (detached mode)")
    .action(async (options) => {
        // Load config from opentunnel.yml if exists (with env variable substitution)
        const configPath = path.join(process.cwd(), CONFIG_FILE);
        let fileConfig: any = {};

        try {
            const parsed = loadConfig(configPath);
            if (parsed?.server && parsed.server.domain) fileConfig = parsed.server;
        } catch (err) {
            // Ignore parse errors, use CLI options
        }

        // Merge config: CLI options override file config, then defaults
        const mergedOptions = {
            port: options.port || fileConfig.port?.toString() || "443",
            publicPort: options.publicPort || fileConfig.publicPort?.toString(),
            domain: options.domain || fileConfig.domain || "localhost",
            basePath: options.basePath || fileConfig.basePath || "op",
            host: options.host || fileConfig.host || "0.0.0.0",
            tcpMin: options.tcpMin || fileConfig.tcpPortMin?.toString() || "10000",
            tcpMax: options.tcpMax || fileConfig.tcpPortMax?.toString() || "20000",
            authTokens: options.authTokens || fileConfig.token,
            https: options.https !== false && fileConfig.https !== false,
            httpsCert: options.httpsCert,
            httpsKey: options.httpsKey,
            letsencrypt: options.letsencrypt,
            email: options.email,
            production: options.production,
            cloudflareToken: options.cloudflareToken,
            duckdnsToken: options.duckdnsToken,
            ipMode: options.ipMode || fileConfig.ipAccess?.mode || "all",
            ipAllow: options.ipAllow || fileConfig.ipAccess?.allowList?.join(","),
            ipDeny: options.ipDeny || fileConfig.ipAccess?.denyList?.join(","),
            dymoApiKey: options.dymoApiKey || fileConfig.dymo?.apiKey,
            dymoBlockBots: options.dymoBlockBots ?? fileConfig.dymo?.blockBots ?? true,
            dymoBlockProxies: options.dymoBlockProxies ?? fileConfig.dymo?.blockProxies ?? false,
            dymoBlockHosting: options.dymoBlockHosting ?? fileConfig.dymo?.blockHosting ?? false,
            dymoCache: options.dymoCache ?? fileConfig.dymo?.cacheResults ?? true,
            dymoCacheTtl: options.dymoCacheTtl ? parseInt(options.dymoCacheTtl) : (fileConfig.dymo?.cacheTTL ?? 300),
            detach: options.detach,
        };
        // Detached mode - run in background
        if (mergedOptions.detach) {
            const { spawn } = await import("child_process");
            const fsAsync = await import("fs");
            const pathAsync = await import("path");

            const pidFile = getPidFilePath("server");
            const logFile = getLogFilePath("server");

            // Check if already running
            if (fsAsync.existsSync(pidFile)) {
                const oldPid = fsAsync.readFileSync(pidFile, "utf-8").trim();
                try {
                    process.kill(parseInt(oldPid), 0);
                    console.log(chalk.yellow(`Server already running (PID: ${oldPid})`));
                    console.log(chalk.gray(`Stop it with: opentunnel stop`));
                    return;
                } catch {
                    fsAsync.unlinkSync(pidFile);
                }
            }

            // Build args without -d flag, using merged options
            const args = ["server"];
            args.push("-p", mergedOptions.port);
            args.push("--domain", mergedOptions.domain);
            args.push("-b", mergedOptions.basePath);
            args.push("--host", mergedOptions.host);
            args.push("--tcp-min", mergedOptions.tcpMin);
            args.push("--tcp-max", mergedOptions.tcpMax);
            if (mergedOptions.publicPort) args.push("--public-port", mergedOptions.publicPort);
            if (mergedOptions.authTokens) args.push("--auth-tokens", mergedOptions.authTokens);
            if (mergedOptions.https) args.push("--https");
            if (mergedOptions.email) args.push("--email", mergedOptions.email);
            if (mergedOptions.production) args.push("--production");
            if (mergedOptions.cloudflareToken) args.push("--cloudflare-token", mergedOptions.cloudflareToken);
            if (mergedOptions.duckdnsToken) args.push("--duckdns-token", mergedOptions.duckdnsToken);
            if (mergedOptions.ipMode && mergedOptions.ipMode !== "all") args.push("--ip-mode", mergedOptions.ipMode);
            if (mergedOptions.ipAllow) args.push("--ip-allow", mergedOptions.ipAllow);
            if (mergedOptions.ipDeny) args.push("--ip-deny", mergedOptions.ipDeny);
            if (mergedOptions.dymoApiKey) args.push("--dymo-api-key", mergedOptions.dymoApiKey);
            if (mergedOptions.dymoBlockBots === false) args.push("--no-dymo-block-bots");
            if (mergedOptions.dymoBlockProxies) args.push("--dymo-block-proxies");
            if (mergedOptions.dymoBlockHosting) args.push("--dymo-block-hosting");

            const out = fsAsync.openSync(logFile, "a");
            const err = fsAsync.openSync(logFile, "a");

            const child = spawn(process.execPath, [process.argv[1], ...args], {
                detached: true,
                stdio: ["ignore", out, err],
                cwd: process.cwd(),
            });

            child.unref();
            fsAsync.writeFileSync(pidFile, String(child.pid));

            console.log(chalk.green(`OpenTunnel server started in background`));
            console.log(chalk.gray(`  PID:      ${child.pid}`));
            console.log(chalk.gray(`  Port:     ${mergedOptions.port}`));
            console.log(chalk.gray(`  Domain:   ${mergedOptions.domain}`));
            console.log(chalk.gray(`  Log:      ${logFile}`));
            console.log(chalk.gray(`  PID file: ${pidFile}`));
            console.log("");
            console.log(chalk.gray(`Stop with:  opentunnel stop`));
            console.log(chalk.gray(`Logs:       tail -f ${logFile}`));
            return;
        }

        // Normal foreground mode
        const { TunnelServer } = await import("../server/TunnelServer");

        // Determine HTTPS configuration (self-signed enabled by default)
        let httpsConfig = undefined;
        let selfSignedHttpsConfig = undefined;
        let autoHttpsConfig = undefined;

        if (mergedOptions.httpsCert && mergedOptions.httpsKey) {
            // Custom certificates provided
            const fsRead = await import("fs");
            httpsConfig = {
                cert: fsRead.readFileSync(mergedOptions.httpsCert, "utf-8"),
                key: fsRead.readFileSync(mergedOptions.httpsKey, "utf-8"),
            };
        } else if (mergedOptions.letsencrypt) {
            // Let's Encrypt
            autoHttpsConfig = {
                enabled: true,
                email: mergedOptions.email || `admin@${mergedOptions.domain}`,
                production: mergedOptions.production || false,
                cloudflareToken: mergedOptions.cloudflareToken,
            };
        } else {
            // Self-signed by default (use --no-https to disable)
            selfSignedHttpsConfig = {
                enabled: mergedOptions.https !== false,
            };
        }

        // Build IP access config
        const ipAccessConfig = mergedOptions.ipMode !== "all" ? {
            mode: mergedOptions.ipMode as "all" | "allowlist" | "denylist",
            allowList: mergedOptions.ipAllow ? mergedOptions.ipAllow.split(",").map((ip: string) => ip.trim()) : undefined,
            denyList: mergedOptions.ipDeny ? mergedOptions.ipDeny.split(",").map((ip: string) => ip.trim()) : undefined,
        } : undefined;

        // Build Dymo API config (optional fraud detection)
        const dymoConfig = mergedOptions.dymoApiKey ? {
            apiKey: mergedOptions.dymoApiKey,
            blockBots: mergedOptions.dymoBlockBots ?? true,
            blockProxies: mergedOptions.dymoBlockProxies ?? false,
            blockHosting: mergedOptions.dymoBlockHosting ?? false,
            cacheResults: mergedOptions.dymoCache ?? true,
            cacheTTL: mergedOptions.dymoCacheTtl ?? 300,
        } : undefined;

        const server = new TunnelServer({
            port: parseInt(mergedOptions.port),
            publicPort: mergedOptions.publicPort ? parseInt(mergedOptions.publicPort) : undefined,
            host: mergedOptions.host,
            domain: mergedOptions.domain,
            basePath: mergedOptions.basePath,
            tunnelPortRange: {
                min: parseInt(mergedOptions.tcpMin),
                max: parseInt(mergedOptions.tcpMax),
            },
            auth: mergedOptions.authTokens
                ? { required: true, tokens: mergedOptions.authTokens.split(",") }
                : undefined,
            ipAccess: ipAccessConfig,
            dymo: dymoConfig,
            https: httpsConfig,
            selfSignedHttps: selfSignedHttpsConfig,
            autoHttps: autoHttpsConfig,
            autoDns: detectDnsConfig(mergedOptions)
        });

        // Helper function to auto-detect DNS provider
        function detectDnsConfig(opts: any) {
            // Auto-detect provider based on tokens or domain
            const domain = opts.domain || "localhost";
            const isDuckDnsDomain = domain.endsWith(".duckdns.org");

            // Priority: explicit token > domain detection
            if (opts.cloudflareToken) {
                return {
                    enabled: true,
                    provider: "cloudflare" as const,
                    cloudflareToken: opts.cloudflareToken,
                    createRecords: false,
                    deleteOnClose: false,
                    setupWildcard: true
                };
            }

            if (opts.duckdnsToken || isDuckDnsDomain) {
                return {
                    enabled: true,
                    provider: "duckdns" as const,
                    duckdnsToken: opts.duckdnsToken,
                    createRecords: false,
                    deleteOnClose: false,
                    setupWildcard: false
                };
            }

            return undefined;
        }

        console.log(chalk.cyan(`
 ██████╗ ██████╗ ███████╗███╗   ██╗████████╗██╗   ██╗███╗   ██╗███╗   ██╗███████╗██╗
██╔═══██╗██╔══██╗██╔════╝████╗  ██║╚══██╔══╝██║   ██║████╗  ██║████╗  ██║██╔════╝██║
██║   ██║██████╔╝█████╗  ██╔██╗ ██║   ██║   ██║   ██║██╔██╗ ██║██╔██╗ ██║█████╗  ██║
██║   ██║██╔═══╝ ██╔══╝  ██║╚██╗██║   ██║   ██║   ██║██║╚██╗██║██║╚██╗██║██╔══╝  ██║
╚██████╔╝██║     ███████╗██║ ╚████║   ██║   ╚██████╔╝██║ ╚████║██║ ╚████║███████╗███████╗
 ╚═════╝ ╚═╝     ╚══════╝╚═╝  ╚═══╝   ╚═╝    ╚═════╝ ╚═╝  ╚═══╝╚═╝  ╚═══╝╚══════╝╚══════╝
`));

        server.on("tunnel:created", ({ tunnelId, publicUrl }) => {
            console.log(chalk.green(`[+] Tunnel created: ${publicUrl}`));
        });

        server.on("tunnel:closed", ({ tunnelId }) => {
            console.log(chalk.yellow(`[-] Tunnel closed: ${tunnelId}`));
        });

        await server.start();
        console.log(chalk.green(`\nServer running on ${mergedOptions.host}:${mergedOptions.port}`));
        console.log(chalk.gray(`Domain: ${mergedOptions.domain}`));
        console.log(chalk.gray(`Subdomain pattern: *.${mergedOptions.basePath}.${mergedOptions.domain}`));
        console.log(chalk.gray(`TCP port range: ${mergedOptions.tcpMin}-${mergedOptions.tcpMax}\n`));
    });

// Stop command
program
    .command("stop")
    .description("Stop the OpenTunnel server running in background")
    .action(async () => {
        const fs = await import("fs");
        const path = await import("path");

        const pidFile = getPidFilePath("server");

        if (!fs.existsSync(pidFile)) {
            console.log(chalk.yellow("No server running (PID file not found)"));
            return;
        }

        const pid = parseInt(fs.readFileSync(pidFile, "utf-8").trim());

        try {
            process.kill(pid, "SIGTERM");
            fs.unlinkSync(pidFile);
            console.log(chalk.green(`Server stopped (PID: ${pid})`));
        } catch (err: any) {
            if (err.code === "ESRCH") {
                fs.unlinkSync(pidFile);
                console.log(chalk.yellow(`Server was not running (stale PID file removed)`));
            } else console.log(chalk.red(`Failed to stop server: ${err.message}`));
        }
    });

// Status command
program
    .command("status")
    .description("Check server status")
    .option("-s, --server <url>", "Server URL", "http://localhost:8080")
    .action(async (options) => {
        const spinner = ora("Checking server status...").start();
        try {
            const http = await import("http");
            const url = new URL("/api/stats", options.server);

            const response = await new Promise<any>((resolve, reject) => {
                http.get(url.toString(), (res) => {
                    let data = "";
                    res.on("data", chunk => data += chunk);
                    res.on("end", () => resolve(JSON.parse(data)));
                }).on("error", reject);
            });

            spinner.succeed("Server is running");
            console.log(chalk.gray(`  Clients: ${response.clients}`));
            console.log(chalk.gray(`  Tunnels: ${response.tunnels}`));
            console.log(chalk.gray(`  Uptime: ${formatDuration(response.uptime * 1000)}`));
        } catch {
            spinner.fail("Server is not reachable");
        }
    });

// List tunnels command
program
    .command("list")
    .description("List active tunnels")
    .option("-s, --server <url>", "Server URL", "http://localhost:8080")
    .action(async (options) => {
        const spinner = ora("Fetching tunnels...").start();
        try {
            const http = await import("http");
            const url = new URL("/api/tunnels", options.server);

            const response = await new Promise<any>((resolve, reject) => {
                http.get(url.toString(), (res) => {
                    let data = "";
                    res.on("data", chunk => data += chunk);
                    res.on("end", () => resolve(JSON.parse(data)));
                }).on("error", reject);
            });

            spinner.stop();

            if (response.tunnels.length === 0) {
                console.log(chalk.yellow("No active tunnels"));
                return;
            }

            console.log(chalk.cyan("\nActive Tunnels:"));
            console.log(chalk.gray("─".repeat(80)));
            for (const tunnel of response.tunnels) {
                console.log(`  ${chalk.white(tunnel.id)}`);
                console.log(`    Protocol: ${chalk.yellow(tunnel.protocol.toUpperCase())}`);
                console.log(`    Local:    ${chalk.gray(tunnel.localAddress)}`);
                console.log(`    Public:   ${chalk.green(tunnel.publicUrl)}`);
                console.log(`    Traffic:  ${chalk.blue(`↓${formatBytes(tunnel.bytesIn)} ↑${formatBytes(tunnel.bytesOut)}`)}`);
                console.log(chalk.gray("─".repeat(80)));
            }
        } catch (err) {
            spinner.fail("Failed to fetch tunnels");
        }
    });

// Setup/help command - explains requirements
program
    .command("setup")
    .description("Show setup instructions for running OpenTunnel on a custom domain")
    .option("--domain <domain>", "Show setup for specific domain")
    .action(async (options) => {
        const domain = options.domain || "yourdomain.com";

        console.log(chalk.cyan(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                        OpenTunnel Setup Guide                                 ║
╚══════════════════════════════════════════════════════════════════════════════╝
`));

        console.log(chalk.white.bold("1. SERVER REQUIREMENTS"));
        console.log(chalk.gray("─".repeat(78)));
        console.log(`
   You need a server (VPS, cloud instance, etc.) with:
   ${chalk.green("✓")} Public IP address
   ${chalk.green("✓")} Ports 80 and 443 open (for HTTP/HTTPS)
   ${chalk.green("✓")} Port 8080 open (for WebSocket tunnel, or use reverse proxy)
   ${chalk.green("✓")} Node.js 18+ installed
`);

        // Try to get public IP for the docs
        let serverIP = "<YOUR_SERVER_IP>";
        try {
            const https = await import("https");
            serverIP = await new Promise<string>((resolve) => {
                https.get("https://api.ipify.org", (res) => {
                    let data = "";
                    res.on("data", (chunk: string) => (data += chunk));
                    res.on("end", () => resolve(data.trim()));
                }).on("error", () => resolve("<YOUR_SERVER_IP>"));
            });
        } catch { }

        console.log(chalk.white.bold("2. DNS CONFIGURATION"));
        console.log(chalk.gray("─".repeat(78)));
        console.log(`
   ${chalk.yellow.bold("Your server's public IP:")} ${chalk.green(serverIP)}

   ${chalk.white.bold("Required DNS Records (create in Cloudflare/your DNS provider):")}

   ┌──────────┬─────────────────────────┬─────────────────────┬──────────────┐
   │ ${chalk.cyan("Type")}     │ ${chalk.cyan("Name")}                    │ ${chalk.cyan("Content")}             │ ${chalk.cyan("Proxy")}        │
   ├──────────┼─────────────────────────┼─────────────────────┼──────────────┤
   │ ${chalk.yellow("A")}        │ op.${domain.padEnd(20)} │ ${serverIP.padEnd(19)} │ ${chalk.red("OFF (DNS only)")} │
   │ ${chalk.yellow("A")}        │ *.op.${domain.padEnd(18)} │ ${serverIP.padEnd(19)} │ ${chalk.red("OFF (DNS only)")} │
   └──────────┴─────────────────────────┴─────────────────────┴──────────────┘

   ${chalk.yellow("⚠ IMPORTANT: Disable Cloudflare Proxy (gray cloud, not orange)")}
   ${chalk.gray("   - Proxy OFF = DNS only (gray cloud) ← Use this")}
   ${chalk.gray("   - Proxy ON  = Proxied (orange cloud) ← Don't use")}

   ${chalk.gray("Why? WebSocket tunnels and TCP don't work well through Cloudflare's proxy.")}

   ${chalk.gray("─".repeat(40))}

   ${chalk.green("Option A: Automatic DNS with Cloudflare (Recommended)")}
   ${chalk.gray("If you provide a Cloudflare token, OpenTunnel will create these records automatically!")}

   ${chalk.cyan("Option B: Manual DNS setup")}
   ${chalk.gray("Create the records above manually in your DNS provider.")}

   ${chalk.gray("After DNS propagation, these URLs will work:")}
   ${chalk.green(`   https://op.${domain}`)}           ${chalk.gray("← Server dashboard")}
   ${chalk.green(`   https://myapp.op.${domain}`)}     ${chalk.gray("← Your tunnel")}
   ${chalk.green(`   https://api.op.${domain}`)}       ${chalk.gray("← Another tunnel")}
   ${chalk.green(`   https://anything.op.${domain}`)}  ${chalk.gray("← Any subdomain")}

   ${chalk.yellow("Tip:")} You can change 'op' to any prefix you prefer (e.g., 'tunnel', 't', etc.)
`);

        console.log(chalk.white.bold("3. SERVER SETUP (Automatic HTTPS + DNS)"));
        console.log(chalk.gray("─".repeat(78)));
        console.log(`
   On your server, run:

   ${chalk.cyan("# Clone and install")}
   git clone https://github.com/FJRG2007/opentunnel.git
   cd opentunnel
   npm install && npm run build

   ${chalk.cyan("# Option A: Full automatic setup with Cloudflare (Recommended)")}
   ${chalk.gray("Get your Cloudflare API token from: https://dash.cloudflare.com/profile/api-tokens")}
   ${chalk.gray("Required permissions: Zone:DNS:Edit")}

   ${chalk.green(`sudo node dist/cli/index.js server \\
     --domain ${domain} \\
     --https \\
     --email admin@${domain} \\
     --cloudflare-token YOUR_CF_API_TOKEN \\
     --production -d`)}

   ${chalk.gray("This will automatically:")}
   ${chalk.green("✓")} Create DNS records (*.op.${domain} and op.${domain})
   ${chalk.green("✓")} Obtain wildcard SSL certificate
   ${chalk.green("✓")} Use DNS-01 challenge (no port 80 needed during setup)
   ${chalk.green("✓")} Listen on port 443 (HTTPS)
   ${chalk.green("✓")} Redirect HTTP (80) to HTTPS
   ${chalk.green("✓")} Auto-renew certificates
   ${chalk.green("✓")} Create individual DNS records per tunnel

   ${chalk.cyan("# Option B: DNS only (no HTTPS)")}
   ${chalk.green(`node dist/cli/index.js server --domain ${domain} --cloudflare-token YOUR_CF_TOKEN -d`)}
   ${chalk.gray("Creates DNS records automatically, HTTP only (port 8080)")}

   ${chalk.cyan("# Option C: Manual DNS + HTTPS")}
   ${chalk.yellow("Note: Requires manual DNS wildcard record setup")}
   ${chalk.green(`sudo node dist/cli/index.js server --domain ${domain} --https --email admin@${domain} --production -d`)}

   ${chalk.cyan("# Option D: Testing/local (no HTTPS, no auto DNS)")}
   node dist/cli/index.js server --domain ${domain} -d

   ${chalk.cyan("# With authentication")}
   sudo node dist/cli/index.js server --domain ${domain} --https --cloudflare-token CF_TOKEN --auth-tokens "secret" -d

   ${chalk.yellow("Note: Use 'sudo' for ports 80/443. Or run without --https on port 8080.")}
`);

        console.log(chalk.white.bold("4. REVERSE PROXY (Optional - only if needed)"));
        console.log(chalk.gray("─".repeat(78)));
        console.log(`
   ${chalk.green("OpenTunnel handles HTTPS automatically!")}
   ${chalk.gray("Only use a reverse proxy if you need additional features.")}

   ${chalk.cyan("# If you prefer using Caddy:")}
   ${domain}, *.op.${domain} {
       reverse_proxy localhost:8080
   }

   ${chalk.cyan("# If you prefer Nginx (requires manual cert setup):")}
   server {
       listen 443 ssl;
       server_name ${domain} *.op.${domain};
       ssl_certificate /etc/letsencrypt/live/${domain}/fullchain.pem;
       ssl_certificate_key /etc/letsencrypt/live/${domain}/privkey.pem;
       location / {
           proxy_pass http://localhost:8080;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection "upgrade";
           proxy_set_header Host $host;
       }
   }
`);

        console.log(chalk.white.bold("5. CLIENT USAGE"));
        console.log(chalk.gray("─".repeat(78)));
        console.log(`
   From your local machine:

   ${chalk.cyan("# Connect to your server")}
   opentunnel http 3000 --subdomain myapp --domain ${domain}

   ${chalk.cyan("# Your local port 3000 will be available at:")}
   ${chalk.green(`https://myapp.op.${domain}`)}

   ${chalk.cyan("# With authentication token")}
   opentunnel http 3000 -n myapp --domain ${domain} -t "secret-token"
`);

        console.log(chalk.white.bold("6. PORT FORWARDING (If behind NAT/Router)"));
        console.log(chalk.gray("─".repeat(78)));
        console.log(`
   If your server is behind a router:

   ${chalk.yellow("Router Settings → Port Forwarding:")}
   ┌────────────────┬───────────────┬────────────────┐
   │ External Port  │ Internal Port │ Protocol       │
   ├────────────────┼───────────────┼────────────────┤
   │ 80             │ 80            │ TCP            │
   │ 443            │ 443           │ TCP            │
   │ 8080           │ 8080          │ TCP            │
   │ 10000-20000    │ 10000-20000   │ TCP (for TCP)  │
   └────────────────┴───────────────┴────────────────┘
`);

        console.log(chalk.white.bold("7. VERIFY SETUP"));
        console.log(chalk.gray("─".repeat(78)));
        console.log(`
   ${chalk.cyan("# Check DNS propagation")}
   nslookup ${domain}
   nslookup test.op.${domain}

   ${chalk.cyan("# Test server connection")}
   curl -I https://${domain}

   ${chalk.cyan("# Test WebSocket endpoint")}
   curl -I https://${domain}/_tunnel
`);

        console.log(chalk.gray("─".repeat(78)));
        console.log(chalk.green("\nNeed help? https://github.com/FJRG2007/opentunnel/issues\n"));
    });

// Init command - create example config
program
    .command("init")
    .description("Create an example opentunnel.yml configuration file")
    .option("-f, --force", "Overwrite existing config file")
    .option("--server", "Create server mode config")
    .option("--client", "Create client mode config (default)")
    .option("--hybrid", "Create hybrid mode config (server + tunnels in one terminal)")
    .action(async (options) => {
        const fsInit = await import("fs");
        const pathInit = await import("path");

        const configPath = pathInit.join(process.cwd(), CONFIG_FILE);
        const envPath = pathInit.join(process.cwd(), ".env");

        if (fsInit.existsSync(configPath) && !options.force) {
            console.log(chalk.yellow(`Config file already exists: ${configPath}`));
            console.log(chalk.gray("Use --force to overwrite"));
            return;
        }

        // Example config with environment variable syntax
        const clientConfig = `# OpenTunnel Client Configuration
# Supports environment variables: \${VAR} or \${VAR:-default}

name: my-tunnels                            # Instance name (shown in ps)
# mode: client                              # Optional: auto-detected from config

server:
  remote: \${SERVER_DOMAIN:-example.com}   # Server domain (system adds basePath)
  token: \${AUTH_TOKEN}                     # From .env (optional)

tunnels:
  - name: web
    protocol: http
    port: 3000
    subdomain: web                          # → web.op.example.com

  - name: api
    protocol: http
    port: 4000
    subdomain: api                          # → api.op.example.com

  - name: database
    protocol: tcp
    port: 5432
    remotePort: 15432                       # → example.com:15432
    autostart: false                        # Don't start automatically
`;

        const serverConfig = `# OpenTunnel Server Configuration
# Supports environment variables: \${VAR} or \${VAR:-default}

name: my-server                             # Instance name (shown in ps)
# mode: server                              # Optional: auto-detected from config

server:
  domain: \${DOMAIN:-example.com}           # Your base domain
  token: \${AUTH_TOKEN}                     # From .env (optional for public server)
  # tcpPortMin: 10000                       # TCP tunnel port range (optional)
  # tcpPortMax: 20000
`;

        const hybridConfig = `# OpenTunnel Hybrid Configuration
# Run server AND expose local ports in the same terminal
# Supports environment variables: \${VAR} or \${VAR:-default}

name: my-hybrid                            # Instance name (shown in ps)
mode: hybrid                               # Server + tunnels in one terminal

server:
  domain: \${DOMAIN:-example.com}           # Your domain
  token: \${AUTH_TOKEN}                     # From .env (optional)
  # tcpPortMin: 10000                       # TCP tunnel port range (optional)
  # tcpPortMax: 20000

tunnels:
  - name: web
    protocol: http
    port: 3000
    subdomain: web                          # → web.op.example.com

  - name: api
    protocol: http
    port: 4000
    subdomain: api                          # → api.op.example.com
`;

        const envExample = `# OpenTunnel Environment Variables
# Copy to .env and fill in your values

# Server/Remote domain
DOMAIN=example.com
SERVER_DOMAIN=example.com

# Authentication token (leave empty for public server)
AUTH_TOKEN=
`;

        const configContent = options.hybrid ? hybridConfig : (options.server ? serverConfig : clientConfig);
        fsInit.writeFileSync(configPath, configContent);

        // Create .env.example if it doesn't exist
        const envExamplePath = pathInit.join(process.cwd(), ".env.example");
        if (!fsInit.existsSync(envExamplePath) && !fsInit.existsSync(envPath)) {
            fsInit.writeFileSync(envExamplePath, envExample);
            console.log(chalk.green(`Created .env.example`));
        }

        console.log(chalk.green(`Created ${CONFIG_FILE}`));
        console.log(chalk.gray(`\nEnvironment variables supported:`));
        console.log(chalk.cyan(`  \${VAR}           → Use value of VAR`));
        console.log(chalk.cyan(`  \${VAR:-default}  → Use VAR or "default" if not set`));
        console.log(chalk.gray(`\nCreate a .env file for secrets, then run:`));
        console.log(chalk.cyan(`  opentunnel up      # Start all tunnels`));
        console.log(chalk.cyan(`  opentunnel up -d   # Start in background`));
    });

// Up command - start tunnels from config
program
    .command("up [name]")
    .description("Start server and tunnels from opentunnel.yml")
    .option("-d, --detach", "Run in background (detached mode)")
    .option("-f, --file <path>", "Config file path", CONFIG_FILE)
    .option("--no-autostart", "Ignore autostart setting, start all tunnels")
    .action(async (name: string | undefined, options) => {
        const fsModule = await import("fs");
        const pathModule = await import("path");

        // Load config to get instance name
        const cfgPath = pathModule.join(process.cwd(), options.file);
        const configForName = loadConfig(cfgPath);

        // Priority: CLI arg > config name > derived from filename
        const instanceName = name ||
            configForName?.name ||
            pathModule.basename(options.file, ".yml").replace("opentunnel", "default");

        // Detached mode - run in background
        const shouldDetach = options.detach === true;

        if (shouldDetach) {
            const { spawn } = await import("child_process");

            const pidFile = getPidFilePath(instanceName);
            const logFile = getLogFilePath(instanceName);

            // Check if already running
            if (fsModule.existsSync(pidFile)) {
                const oldPid = fsModule.readFileSync(pidFile, "utf-8").trim();
                try {
                    process.kill(parseInt(oldPid), 0);
                    console.log(chalk.yellow(`Instance "${instanceName}" already running (PID: ${oldPid})`));
                    console.log(chalk.gray(`Stop with: opentunnel down ${instanceName}`));
                    return;
                } catch {
                    fsModule.unlinkSync(pidFile);
                }
            }

            // Build args without -d flag
            const args = ["up", instanceName];
            if (options.file !== CONFIG_FILE) args.push("-f", options.file);
            if (options.autostart === false) args.push("--no-autostart");

            const out = fsModule.openSync(logFile, "a");
            const err = fsModule.openSync(logFile, "a");

            const child = spawn(process.execPath, [process.argv[1], ...args], {
                detached: true,
                stdio: ["ignore", out, err],
                cwd: process.cwd(),
            });

            child.unref();
            fsModule.writeFileSync(pidFile, String(child.pid));

            // Wait and verify process is still running (check multiple times)
            let isRunning = false;
            for (let i = 0; i < 5; i++) {
                await new Promise(resolve => setTimeout(resolve, 500));
                try {
                    process.kill(child.pid!, 0);
                    isRunning = true;
                } catch {
                    isRunning = false;
                    break;
                }
            }

            if (isRunning) {
                // Register in global registry
                registerInstance({
                    name: instanceName,
                    pid: child.pid!,
                    configPath: cfgPath,
                    logFile,
                    pidFile,
                    cwd: process.cwd(),
                    startedAt: new Date().toISOString(),
                });

                console.log(chalk.green(`OpenTunnel "${instanceName}" started in background`));
                console.log(chalk.gray(`  PID:      ${child.pid}`));
                console.log(chalk.gray(`  Log:      ${logFile}`));
                console.log(chalk.gray(`  CWD:      ${process.cwd()}`));
                console.log("");
                console.log(chalk.gray(`Stop with:  opentunnel down ${instanceName}`));
                console.log(chalk.gray(`Stop all:   opentunnel down --all`));
                console.log(chalk.gray(`List:       opentunnel ps`));
                console.log(chalk.gray(`Logs:       opentunnel logs ${instanceName}`));
            } else {
                // Process died - show error from log
                console.log(chalk.red(`\n✗ OpenTunnel "${instanceName}" failed to start\n`));

                // Read log and find error
                try {
                    const logContent = fsModule.readFileSync(logFile, "utf-8");
                    const lines = logContent.trim().split("\n");

                    // Look for common errors
                    const errorLine = lines.find(l =>
                        l.includes("EADDRINUSE") ||
                        l.includes("EACCES") ||
                        l.includes("Error:") ||
                        l.includes("error:")
                    );

                    if (errorLine) {
                        if (errorLine.includes("EADDRINUSE")) {
                            console.log(chalk.red("  Error: Port already in use"));
                            console.log(chalk.gray("  Another process is using the port. Try:"));
                            console.log(chalk.cyan("    - Stop other OpenTunnel: opentunnel down --all"));
                            console.log(chalk.cyan("    - Use different port in config: server.port: 8443"));
                        } else if (errorLine.includes("EACCES")) {
                            console.log(chalk.red("  Error: Permission denied"));
                            console.log(chalk.gray("  Port 443 requires admin/root. Try:"));
                            console.log(chalk.cyan("    - Run as administrator"));
                            console.log(chalk.cyan("    - Use port > 1024 in config"));
                        } else {
                            console.log(chalk.red(`  ${errorLine}`));
                        }
                    }

                    // Show last few lines
                    console.log(chalk.gray("\n  Last log lines:"));
                    console.log(chalk.gray("  " + "─".repeat(56)));
                    for (const line of lines.slice(-8)) {
                        console.log(chalk.gray(`  ${line}`));
                    }
                    console.log(chalk.gray("  " + "─".repeat(56)));
                } catch {
                    console.log(chalk.gray(`Check log: cat ${logFile}`));
                }

                // Clean up pid file
                try {
                    fsModule.unlinkSync(pidFile);
                } catch {}
            }
            return;
        }

        // Load config file (with env variable substitution)
        const configPath = pathModule.join(process.cwd(), options.file);
        const config = loadConfig(configPath);

        if (!config) {
            console.log(chalk.red(`Config file not found: ${configPath}`));
            console.log(chalk.gray(`Run 'opentunnel init' to create one`));
            return;
        }

        const tunnelsToStart = options.autostart === false
            ? (config.tunnels || [])
            : (config.tunnels?.filter(t => t.autostart !== false) || []);

        // Display banner
        console.log(chalk.cyan(`
 ██████╗ ██████╗ ███████╗███╗   ██╗████████╗██╗   ██╗███╗   ██╗███╗   ██╗███████╗██╗
██╔═══██╗██╔══██╗██╔════╝████╗  ██║╚══██╔══╝██║   ██║████╗  ██║████╗  ██║██╔════╝██║
██║   ██║██████╔╝█████╗  ██╔██╗ ██║   ██║   ██║   ██║██╔██╗ ██║██╔██╗ ██║█████╗  ██║
██║   ██║██╔═══╝ ██╔══╝  ██║╚██╗██║   ██║   ██║   ██║██║╚██╗██║██║╚██╗██║██╔══╝  ██║
╚██████╔╝██║     ███████╗██║ ╚████║   ██║   ╚██████╔╝██║ ╚████║██║ ╚████║███████╗███████╗
 ╚═════╝ ╚═╝     ╚══════╝╚═╝  ╚═══╝   ╚═╝    ╚═════╝ ╚═╝  ╚═══╝╚═╝  ╚═══╝╚══════╝╚══════╝
`));

        // Get config values
        const domain = config.server?.domain;
        const remote = config.server?.remote;  // New: connect to remote server
        const basePath = config.server?.basePath || "op";
        const port = config.server?.port || 443;
        const useHttps = config.server?.https !== false;
        const hasTunnels = tunnelsToStart.length > 0;

        // Parse multiple domains from config
        // Helper to check if domain is DuckDNS
        const isDuckDns = (domain: string) => domain.toLowerCase().endsWith(".duckdns.org");

        let serverDomains: { domain: string; basePath: string; wildcard?: boolean }[] | undefined;
        if (config.server?.domains && config.server.domains.length > 0) {
            serverDomains = config.server.domains.map(d => {
                if (typeof d === "string") {
                    // DuckDNS domains don't use basePath
                    return { domain: d, basePath: isDuckDns(d) ? "" : basePath };
                }
                // If basePath is explicitly set for DuckDNS, it will error in TunnelServer
                // If not set, default to empty for DuckDNS, or global basePath for others
                const domainBasePath = d.basePath !== undefined
                    ? d.basePath
                    : (isDuckDns(d.domain) ? "" : basePath);
                return {
                    domain: d.domain,
                    basePath: domainBasePath,
                    wildcard: d.wildcard,
                };
            });
        }

        // Check if we have domain configuration (single or multiple)
        const hasDomainConfig = domain || (serverDomains && serverDomains.length > 0);

        // Mode detection:
        // 1. Explicit mode in config takes priority
        // 2. Auto-detect based on config:
        //    - "remote" specified -> client mode (connect to remote server)
        //    - "domain" or "domains" specified -> server mode (start local server)
        //    - "domain"/"domains" + tunnels -> hybrid mode (server + tunnels in same terminal)
        let mode: OpenTunnelMode;

        if (config.mode) {
            // Explicit mode
            mode = config.mode;
        } else {
            // Auto-detect
            if (remote && hasTunnels) {
                mode = "client";
            } else if (hasDomainConfig && hasTunnels) {
                mode = "hybrid";
            } else if (hasDomainConfig) {
                mode = "server";
            } else {
                mode = "client"; // Default fallback
            }
        }

        const isClientMode = mode === "client";
        const isServerMode = mode === "server";
        const isHybridMode = mode === "hybrid";

        if (!hasDomainConfig && !remote) {
            console.log(chalk.red("Missing configuration."));
            console.log(chalk.gray("\nAdd to your config:"));
            console.log(chalk.cyan("\n  # Run your own server:"));
            console.log(chalk.white("  server:"));
            console.log(chalk.white("    domain: example.com"));
            console.log(chalk.cyan("\n  # Or connect to a remote server:"));
            console.log(chalk.white("  server:"));
            console.log(chalk.white("    remote: example.com"));
            process.exit(1);
        }

        if (isClientMode) {
            // CLIENT MODE: Connect to remote server
            // Build URL using basePath (default: op) -> wss://op.example.com/_tunnel
            const { url: serverUrl } = buildServerUrl(remote!, basePath);

            console.log(chalk.cyan(`Connecting to ${remote}...\n`));
            console.log(chalk.cyan(`Starting ${tunnelsToStart.length} tunnel(s)...\n`));

            try {
                await startTunnelsFromConfig(tunnelsToStart, serverUrl, config.server?.token, true);

                console.log(chalk.gray("\nPress Ctrl+C to stop"));

                // Keep running
                await new Promise(() => {});
            } catch (error: any) {
                console.log(chalk.red(`Failed to connect: ${error.message}`));
                process.exit(1);
            }
        } else if (isServerMode || isHybridMode) {
            // SERVER/HYBRID MODE: Start local server
            // Hybrid mode also starts tunnels in the same terminal
            const { TunnelServer } = await import("../server/TunnelServer");

            const tcpMin = config.server?.tcpPortMin || 10000;
            const tcpMax = config.server?.tcpPortMax || 20000;

            const spinner = ora("Starting server...").start();

            const server = new TunnelServer({
                port,
                host: "0.0.0.0",
                domain: domain || serverDomains?.[0]?.domain || "localhost",
                basePath,
                domains: serverDomains,  // Pass multiple domains if configured
                tunnelPortRange: {
                    min: tcpMin,
                    max: tcpMax,
                },
                selfSignedHttps: useHttps ? { enabled: true } : undefined,
                // In hybrid mode, auth is not needed for localhost. For remote clients, still require token.
                auth: config.server?.token && !isHybridMode ? { required: true, tokens: [config.server.token] } : undefined,
                dymo: config.server?.dymo,
                ipAccess: config.server?.ipAccess as any,
            });

            try {
                await server.start();
                const primaryDomain = serverDomains?.[0]?.domain || domain;
                const primaryBasePath = serverDomains?.[0]?.basePath || basePath;
                spinner.succeed(`Server running on https://${primaryBasePath}.${primaryDomain}:${port}`);

                // Show all domains if multiple configured
                if (serverDomains && serverDomains.length > 1) {
                    console.log(chalk.cyan("\nConfigured domains:"));
                    for (const d of serverDomains) {
                        console.log(chalk.white(`  *.${d.basePath}.${d.domain}`));
                    }
                }

                // Start tunnels if in hybrid mode or if tunnels are defined
                if (isHybridMode && hasTunnels) {
                    console.log(chalk.cyan(`\nStarting ${tunnelsToStart.length} tunnel(s)...\n`));

                    const wsProtocol = useHttps ? "wss" : "ws";
                    const serverUrl = `${wsProtocol}://localhost:${port}/_tunnel`;

                    // Small delay to ensure server is fully ready
                    await new Promise(resolve => setTimeout(resolve, 500));

                    await startTunnelsFromConfig(tunnelsToStart, serverUrl, config.server?.token, true);
                } else if (isServerMode) {
                    console.log(chalk.gray("\nServer ready. Waiting for connections..."));
                }

                console.log(chalk.gray("\nPress Ctrl+C to stop"));

                // Keep running
                await new Promise(() => {});
            } catch (error: any) {
                spinner.fail(`Failed to start: ${error.message}`);
                process.exit(1);
            }
        }
    });

// Down command - stop tunnels (uses global registry)
program
    .command("down [name]")
    .description("Stop running tunnels by name or all with --all")
    .option("--all", "Stop ALL running instances globally")
    .option("--local", "Only stop instances from current directory")
    .action(async (name: string | undefined, options) => {
        const fs = await import("fs");

        const registry = loadRegistry();
        let instancesToStop: InstanceInfo[] = [];

        if (options.all) {
            // Stop all instances globally
            instancesToStop = registry.instances;
        } else if (name) {
            // Stop specific instance by name (search globally)
            instancesToStop = registry.instances.filter(i => i.name === name);
            if (instancesToStop.length === 0) {
                console.log(chalk.yellow(`Instance "${name}" not found`));
                console.log(chalk.gray(`Use 'opentunnel ps' to list running instances`));
                return;
            }
        } else if (options.local) {
            // Stop all instances from current directory
            instancesToStop = registry.instances.filter(i => i.cwd === process.cwd());
        } else {
            // Default: stop instances from current directory
            instancesToStop = registry.instances.filter(i => i.cwd === process.cwd());
        }

        if (instancesToStop.length === 0) {
            console.log(chalk.yellow("No tunnels running"));
            console.log(chalk.gray("Use 'opentunnel ps' to list all instances"));
            return;
        }

        console.log(chalk.cyan(`Stopping ${instancesToStop.length} process(es)...\n`));

        for (const instance of instancesToStop) {
            try {
                process.kill(instance.pid, "SIGTERM");
                console.log(chalk.green(`  ✓ Stopped ${instance.name} (PID: ${instance.pid})`));
            } catch (err: any) {
                if (err.code === "ESRCH") {
                    console.log(chalk.yellow(`  - ${instance.name} was not running (cleaned up)`));
                } else {
                    console.log(chalk.red(`  ✗ Failed to stop ${instance.name}: ${err.message}`));
                }
            }

            // Remove PID file if exists
            try {
                if (fs.existsSync(instance.pidFile)) {
                    fs.unlinkSync(instance.pidFile);
                }
            } catch {}

            // Remove from registry
            unregisterInstanceByPid(instance.pid);
        }

        const stoppedCount = instancesToStop.length;
        if (options.all) {
            console.log(chalk.green(`\nAll ${stoppedCount} instance(s) stopped`));
        } else if (name) {
            console.log(chalk.green(`\n"${name}" stopped`));
        } else {
            console.log(chalk.green(`\n${stoppedCount} instance(s) stopped`));
        }
    });

// Restart command - stop and start again
program
    .command("restart [name]")
    .description("Restart tunnels (equivalent to down + up)")
    .option("-f, --file <file>", "Config file", "opentunnel.yml")
    .action(async (name: string | undefined, options) => {
        const fs = await import("fs");
        const pathModule = await import("path");
        const { spawn } = await import("child_process");

        const registry = loadRegistry();
        let instancesToRestart: InstanceInfo[] = [];

        if (name) {
            // Restart specific instance by name
            instancesToRestart = registry.instances.filter(i => i.name === name);
            if (instancesToRestart.length === 0) {
                console.log(chalk.yellow(`Instance "${name}" not found`));
                console.log(chalk.gray(`Use 'opentunnel ps' to list running instances`));
                return;
            }
        } else {
            // Restart instances from current directory
            instancesToRestart = registry.instances.filter(i => i.cwd === process.cwd());
        }

        if (instancesToRestart.length === 0) {
            console.log(chalk.yellow("No tunnels running to restart"));
            console.log(chalk.gray("Use 'opentunnel up -d' to start tunnels"));
            return;
        }

        console.log(chalk.cyan(`Restarting ${instancesToRestart.length} instance(s)...\n`));

        for (const instance of instancesToRestart) {
            // Step 1: Stop the instance
            try {
                process.kill(instance.pid, "SIGTERM");
                console.log(chalk.yellow(`  ↓ Stopped ${instance.name}`));
            } catch (err: any) {
                if (err.code !== "ESRCH") {
                    console.log(chalk.red(`  ✗ Failed to stop ${instance.name}: ${err.message}`));
                    continue;
                }
            }

            // Remove PID file
            try {
                if (fs.existsSync(instance.pidFile)) {
                    fs.unlinkSync(instance.pidFile);
                }
            } catch {}

            // Unregister from registry
            unregisterInstanceByPid(instance.pid);

            // Wait a bit for the process to fully stop
            await new Promise(resolve => setTimeout(resolve, 500));

            // Step 2: Start the instance again
            const configPath = instance.configPath;
            if (!fs.existsSync(configPath)) {
                console.log(chalk.red(`  ✗ Config file not found: ${configPath}`));
                continue;
            }

            // Spawn new process
            const logFile = instance.logFile;
            const pidFile = instance.pidFile;
            const instanceName = instance.name;
            const cwd = instance.cwd;

            // Open file descriptor for logging (required for detached processes)
            const logFd = fs.openSync(logFile, "a");

            const child = spawn(process.execPath, [process.argv[1], "up", "-f", pathModule.basename(configPath)], {
                cwd,
                detached: true,
                stdio: ["ignore", logFd, logFd],
                env: { ...process.env, OPENTUNNEL_INSTANCE_NAME: instanceName },
            });

            child.unref();
            fs.closeSync(logFd);

            // Wait and check if process started successfully
            await new Promise(resolve => setTimeout(resolve, 1500));

            let processRunning = false;
            try {
                process.kill(child.pid!, 0);
                processRunning = true;
            } catch {
                processRunning = false;
            }

            if (processRunning) {
                // Process is running, register it
                registerInstance({
                    name: instanceName,
                    pid: child.pid!,
                    configPath,
                    logFile,
                    pidFile,
                    cwd,
                    startedAt: new Date().toISOString(),
                });

                // Write PID file
                fs.writeFileSync(pidFile, child.pid!.toString());

                console.log(chalk.green(`  ↑ Started ${instanceName} (PID: ${child.pid})`));
            } else {
                // Process failed - check logs for error
                console.log(chalk.red(`  ✗ Failed to start ${instanceName}`));

                // Read last lines of log to show error
                if (fs.existsSync(logFile)) {
                    const logContent = fs.readFileSync(logFile, "utf-8");
                    const lines = logContent.split("\n");

                    // Find error lines
                    const errorLines: string[] = [];
                    let capturing = false;
                    for (let i = lines.length - 1; i >= 0 && errorLines.length < 10; i--) {
                        const line = lines[i];
                        if (line.includes("Error:") || line.includes("error:") || capturing) {
                            errorLines.unshift(line);
                            capturing = true;
                        }
                        if (line.includes("throw new Error") || line.includes("at new")) {
                            capturing = true;
                        }
                    }

                    if (errorLines.length > 0) {
                        console.log(chalk.red("\n  Error details:"));
                        console.log(chalk.gray("  " + "─".repeat(60)));
                        // Find the actual error message
                        const errorMsg = errorLines.find(l => l.includes("Error:"));
                        if (errorMsg) {
                            const match = errorMsg.match(/Error:\s*(.+)/);
                            if (match) {
                                console.log(chalk.red(`  ${match[1]}`));
                            }
                        }
                        console.log(chalk.gray("  " + "─".repeat(60)));
                    }
                }
            }
        }

        console.log();
    });

// PS command - list running tunnel processes (global)
program
    .command("ps")
    .description("List all running OpenTunnel processes (global)")
    .option("--clean", "Remove entries for stopped processes")
    .option("--local", "Only show processes from current directory")
    .action(async (options) => {
        const fs = await import("fs");
        const pathMod = await import("path");

        const registry = loadRegistry();
        let instances = registry.instances;

        // Filter to local only if requested
        if (options.local) {
            instances = instances.filter(i => i.cwd === process.cwd());
        }

        if (instances.length === 0) {
            console.log(chalk.yellow("No tunnels running"));
            console.log(chalk.gray("Start tunnels with: opentunnel up -d"));
            return;
        }

        console.log(chalk.cyan("\nOpenTunnel Processes:"));
        console.log(chalk.gray("─".repeat(90)));
        console.log(chalk.gray(`  ${"NAME".padEnd(15)} ${"PID".padEnd(8)} ${"STATUS".padEnd(10)} ${"DIRECTORY"}`));
        console.log(chalk.gray("─".repeat(90)));

        const stoppedInstances: InstanceInfo[] = [];
        let hasRunning = false;

        for (const instance of instances) {
            let status = "unknown";
            let statusColor = chalk.gray;

            try {
                process.kill(instance.pid, 0); // Check if process exists
                status = "running";
                statusColor = chalk.green;
                hasRunning = true;
            } catch {
                status = "stopped";
                statusColor = chalk.red;
                stoppedInstances.push(instance);
            }

            // Shorten the directory path for display
            const shortCwd = instance.cwd.length > 40
                ? "..." + instance.cwd.slice(-37)
                : instance.cwd;

            console.log(`  ${chalk.white(instance.name.padEnd(15))} ${chalk.gray(String(instance.pid).padEnd(8))} ${statusColor(status.padEnd(10))} ${chalk.gray(shortCwd)}`);
        }

        console.log(chalk.gray("─".repeat(90)));

        // Clean up stopped processes if requested
        if (options.clean && stoppedInstances.length > 0) {
            for (const instance of stoppedInstances) {
                // Remove from registry
                unregisterInstanceByPid(instance.pid);
                // Remove PID file if exists
                try {
                    if (fs.existsSync(instance.pidFile)) {
                        fs.unlinkSync(instance.pidFile);
                    }
                } catch {}
            }
            console.log(chalk.yellow(`\nCleaned up ${stoppedInstances.length} stopped process(es)`));
        } else if (stoppedInstances.length > 0) {
            console.log(chalk.gray(`\n${stoppedInstances.length} stopped. Run 'opentunnel ps --clean' to remove.`));
        }

        if (hasRunning) {
            console.log(chalk.gray(`\nStop by name:  opentunnel down <name>`));
            console.log(chalk.gray(`Stop all:      opentunnel down --all`));
        }
    });

// Logs command - view logs for an instance
program
    .command("logs [name]")
    .description("View logs for an instance")
    .option("-f, --follow", "Follow log output (like tail -f)")
    .option("-n, --lines <n>", "Number of lines to show", "50")
    .action(async (name: string | undefined, options) => {
        const fs = await import("fs");
        const { spawn } = await import("child_process");

        const registry = loadRegistry();

        // Find instance
        let instance: InstanceInfo | undefined;

        if (name) {
            instance = registry.instances.find(i => i.name === name);
        } else {
            // Use first instance from current directory
            instance = registry.instances.find(i => i.cwd === process.cwd());
        }

        if (!instance) {
            console.log(chalk.yellow(name ? `Instance "${name}" not found` : "No instance found in current directory"));
            console.log(chalk.gray("Use 'opentunnel ps' to list instances"));
            return;
        }

        if (!fs.existsSync(instance.logFile)) {
            console.log(chalk.yellow(`Log file not found: ${instance.logFile}`));
            return;
        }

        if (options.follow) {
            // Use tail -f equivalent
            console.log(chalk.gray(`Following logs for ${instance.name}... (Ctrl+C to stop)\n`));

            // Read existing content first
            const content = fs.readFileSync(instance.logFile, "utf-8");
            const lines = content.split("\n").slice(-parseInt(options.lines));
            console.log(lines.join("\n"));

            // Watch for changes
            let lastSize = fs.statSync(instance.logFile).size;
            const watcher = setInterval(() => {
                try {
                    const stat = fs.statSync(instance!.logFile);
                    if (stat.size > lastSize) {
                        const fd = fs.openSync(instance!.logFile, "r");
                        const buffer = Buffer.alloc(stat.size - lastSize);
                        fs.readSync(fd, buffer, 0, buffer.length, lastSize);
                        fs.closeSync(fd);
                        process.stdout.write(buffer.toString());
                        lastSize = stat.size;
                    }
                } catch {
                    clearInterval(watcher);
                }
            }, 100);

            // Handle Ctrl+C
            process.on("SIGINT", () => {
                clearInterval(watcher);
                process.exit(0);
            });

            // Keep running
            await new Promise(() => {});
        } else {
            // Just show last N lines
            const content = fs.readFileSync(instance.logFile, "utf-8");
            const lines = content.split("\n").slice(-parseInt(options.lines));
            console.log(chalk.gray(`Last ${options.lines} lines of ${instance.name}:\n`));
            console.log(lines.join("\n"));
        }
    });

// Logs clean command - remove log files
program
    .command("logs-clean [name]")
    .description("Clean log files")
    .option("--all", "Clean all log files")
    .action(async (name: string | undefined, options) => {
        const fs = await import("fs");
        const logsDir = getLogsDir();

        if (!fs.existsSync(logsDir)) {
            console.log(chalk.yellow("No logs directory found"));
            return;
        }

        let files: string[];

        if (options.all) {
            // Clean all log files
            files = fs.readdirSync(logsDir).filter(f => f.endsWith(".log"));
        } else if (name) {
            // Clean specific instance logs
            const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "_");
            const logFile = `${safeName}.log`;
            files = fs.existsSync(path.join(logsDir, logFile)) ? [logFile] : [];
        } else {
            console.log(chalk.yellow("Specify instance name or use --all to clean all logs"));
            console.log(chalk.gray(`  opentunnel logs-clean <name>    Clean logs for specific instance`));
            console.log(chalk.gray(`  opentunnel logs-clean --all     Clean all log files`));
            return;
        }

        if (files.length === 0) {
            console.log(chalk.yellow(name ? `No logs found for "${name}"` : "No log files found"));
            return;
        }

        let totalSize = 0;
        for (const file of files) {
            const filePath = path.join(logsDir, file);
            try {
                const stat = fs.statSync(filePath);
                totalSize += stat.size;
                fs.unlinkSync(filePath);
                console.log(chalk.green(`  ✓ Deleted ${file} (${(stat.size / 1024).toFixed(1)} KB)`));
            } catch (err: any) {
                console.log(chalk.red(`  ✗ Failed to delete ${file}: ${err.message}`));
            }
        }

        console.log(chalk.gray(`\nCleaned ${files.length} file(s), freed ${(totalSize / 1024).toFixed(1)} KB`));
        console.log(chalk.gray(`Logs directory: ${logsDir}`));
    });

// Logs list command - show logs directory and list log files
program
    .command("logs-list")
    .description("List all log files and show logs directory")
    .action(async () => {
        const fs = await import("fs");
        const logsDir = getLogsDir();

        console.log(chalk.cyan(`Logs directory: ${logsDir}\n`));

        if (!fs.existsSync(logsDir)) {
            console.log(chalk.yellow("No logs directory found"));
            return;
        }

        const files = fs.readdirSync(logsDir).filter(f => f.endsWith(".log") || f.endsWith(".pid"));

        if (files.length === 0) {
            console.log(chalk.yellow("No log files found"));
            return;
        }

        const logFiles = files.filter(f => f.endsWith(".log"));
        const pidFiles = files.filter(f => f.endsWith(".pid"));

        if (logFiles.length > 0) {
            console.log(chalk.white("Log files:"));
            let totalSize = 0;
            for (const file of logFiles) {
                const filePath = path.join(logsDir, file);
                const stat = fs.statSync(filePath);
                const size = (stat.size / 1024).toFixed(1);
                const modified = stat.mtime.toLocaleString();
                totalSize += stat.size;
                console.log(chalk.gray(`  ${file.padEnd(35)} ${size.padStart(8)} KB  ${modified}`));
            }
            console.log(chalk.gray(`\n  Total: ${logFiles.length} file(s), ${(totalSize / 1024).toFixed(1)} KB`));
        }

        if (pidFiles.length > 0) {
            console.log(chalk.white("\nPID files (active instances):"));
            for (const file of pidFiles) {
                const filePath = path.join(logsDir, file);
                const pid = fs.readFileSync(filePath, "utf-8").trim();
                const name = file.replace(".pid", "");
                let status = chalk.green("running");
                try {
                    process.kill(parseInt(pid), 0);
                } catch {
                    status = chalk.red("stale");
                }
                console.log(chalk.gray(`  ${name.padEnd(35)} PID: ${pid.padStart(6)}  ${status}`));
            }
        }
    });

// Test server command - simple HTTP server for testing tunnels
program
    .command("test-server")
    .description("Start a simple HTTP test server")
    .option("-p, --port <port>", "Port to listen on", "3000")
    .option("-d, --detach", "Run in background")
    .action(async (options) => {
        const http = await import("http");
        const port = parseInt(options.port);

        if (options.detach) {
            const { spawn } = await import("child_process");
            const fs = await import("fs");
            const path = await import("path");

            const pidFile = getPidFilePath(`test-server-${port}`);
            const logFile = getLogFilePath(`test-server-${port}`);

            if (fs.existsSync(pidFile)) {
                const oldPid = fs.readFileSync(pidFile, "utf-8").trim();
                try {
                    process.kill(parseInt(oldPid), 0);
                    console.log(chalk.yellow(`Test server already running on port ${port} (PID: ${oldPid})`));
                    return;
                } catch {
                    fs.unlinkSync(pidFile);
                }
            }

            const out = fs.openSync(logFile, "a");
            const err = fs.openSync(logFile, "a");

            const child = spawn(process.execPath, [process.argv[1], "test-server", "-p", String(port)], {
                detached: true,
                stdio: ["ignore", out, err],
                cwd: process.cwd(),
            });

            child.unref();
            fs.writeFileSync(pidFile, String(child.pid));

            console.log(chalk.green(`Test server started on port ${port}`));
            console.log(chalk.gray(`  PID: ${child.pid}`));
            console.log(chalk.gray(`  URL: http://localhost:${port}`));
            console.log(chalk.gray(`  Log: ${logFile}`));
            return;
        }

        const server = http.createServer((req, res) => {
            const timestamp = new Date().toISOString();
            const method = req.method;
            const url = req.url;
            const headers = JSON.stringify(req.headers, null, 2);

            console.log(chalk.cyan(`[${timestamp}] ${method} ${url}`));

            // Collect body for POST/PUT
            let body = "";
            req.on("data", (chunk) => { body += chunk; });
            req.on("end", () => {
                const response = {
                    success: true,
                    message: "OpenTunnel Test Server",
                    request: {
                        method,
                        url,
                        headers: req.headers,
                        body: body || undefined
                    },
                    server: {
                        port,
                        timestamp,
                        uptime: process.uptime()
                    }
                };

                res.writeHead(200, {
                    "Content-Type": "application/json",
                    "X-Powered-By": "OpenTunnel Test Server",
                });
                res.end(JSON.stringify(response, null, 2));
            });
        });

        server.listen(port, () => {
            console.log(chalk.green(`\n  OpenTunnel Test Server`));
            console.log(chalk.gray("  ─────────────────────────────────────────"));
            console.log(`  ${chalk.white("Status:")}   ${chalk.green("● Running")}`);
            console.log(`  ${chalk.white("Port:")}     ${chalk.cyan(port)}`);
            console.log(`  ${chalk.white("URL:")}      ${chalk.cyan(`http://localhost:${port}`)}`);
            console.log(chalk.gray("  ─────────────────────────────────────────"));
            console.log(chalk.gray("\n  Endpoints:"));
            console.log(chalk.gray(`    GET  /         → Returns server info`));
            console.log(chalk.gray(`    GET  /health   → Health check`));
            console.log(chalk.gray(`    POST /echo     → Echo request body`));
            console.log(chalk.gray(`    ANY  /*        → Returns request details`));
            console.log(chalk.gray("\n  Press Ctrl+C to stop\n"));
        });

        process.on("SIGINT", () => {
            console.log(chalk.yellow("\n  Shutting down..."));
            server.close(() => {
                console.log(chalk.green("  Test server stopped"));
                process.exit(0);
            });
        });
    });

// Stop test servers command
program
    .command("test-server-stop")
    .description("Stop all test servers")
    .option("-p, --port <port>", "Stop specific port")
    .action(async (options) => {
        const fs = await import("fs");

        const logsDir = getLogsDir();
        let pidFiles: string[];

        if (options.port) {
            const pidPath = getPidFilePath(`test-server-${options.port}`);
            pidFiles = fs.existsSync(pidPath) ? [pidPath] : [];
        } else {
            pidFiles = fs.readdirSync(logsDir)
                .filter(f => f.startsWith("test-server-") && f.endsWith(".pid"))
                .map(f => path.join(logsDir, f));
        }

        if (pidFiles.length === 0) {
            console.log(chalk.yellow("No test servers running"));
            return;
        }

        for (const pidPath of pidFiles) {
            const pid = parseInt(fs.readFileSync(pidPath, "utf-8").trim());
            const fileName = path.basename(pidPath);
            const port = fileName.replace("test-server-", "").replace(".pid", "");

            try {
                process.kill(pid, "SIGTERM");
                fs.unlinkSync(pidPath);
                console.log(chalk.green(`  ✓ Stopped test server on port ${port} (PID: ${pid})`));
            } catch (err: any) {
                if (err.code === "ESRCH") {
                    fs.unlinkSync(pidPath);
                    console.log(chalk.yellow(`  - Test server on port ${port} was not running`));
                }
            }
        }
    });

async function runTunnelInBackgroundFromConfig(
    name: string,
    protocol: string,
    port: number,
    options: any
): Promise<void> {
    const { spawn } = await import("child_process");
    const fs = await import("fs");
    const path = await import("path");

    const pidFile = getPidFilePath(name);
    const logFile = getLogFilePath(name);

    // Check if already running
    if (fs.existsSync(pidFile)) {
        const oldPid = fs.readFileSync(pidFile, "utf-8").trim();
        try {
            process.kill(parseInt(oldPid), 0);
            console.log(chalk.yellow(`  - ${name}: already running (PID: ${oldPid})`));
            return;
        } catch {
            fs.unlinkSync(pidFile);
        }
    }

    // Build args
    const args = [protocol, String(port)];
    if (options.subdomain) args.push("-n", options.subdomain);
    if (options.server) args.push("-s", options.server);
    if (options.token) args.push("-t", options.token);
    if (options.host) args.push("-h", options.host);
    if (options.remotePort) args.push("-r", String(options.remotePort));

    const out = fs.openSync(logFile, "a");
    const err = fs.openSync(logFile, "a");

    const child = spawn(process.execPath, [process.argv[1], ...args], {
        detached: true,
        stdio: ["ignore", out, err],
        cwd: process.cwd(),
    });

    child.unref();
    fs.writeFileSync(pidFile, String(child.pid));

    console.log(chalk.green(`  ✓ ${name}: started (PID: ${child.pid})`));
};

async function startTunnelsFromConfig(
    tunnels: TunnelConfigYaml[],
    serverUrl: string,
    token?: string,
    insecure?: boolean
): Promise<void> {
    const spinner = ora("Connecting to server...").start();

    const client = new TunnelClient({
        serverUrl,
        token,
        reconnect: true,
        silent: true,
        rejectUnauthorized: !insecure,
    });

    try {
        await client.connect();
        spinner.succeed("Connected to server");

        const activeTunnels: { name: string; tunnelId: string; publicUrl: string }[] = [];

        for (const tunnel of tunnels) {
            const tunnelSpinner = ora(`Creating tunnel: ${tunnel.name}...`).start();

            try {
                const { tunnelId, publicUrl } = await client.createTunnel({
                    protocol: tunnel.protocol as TunnelProtocol,
                    localHost: tunnel.host || "localhost",
                    localPort: tunnel.port,
                    subdomain: tunnel.subdomain,
                    remotePort: tunnel.remotePort,
                });

                activeTunnels.push({ name: tunnel.name, tunnelId, publicUrl });
                tunnelSpinner.succeed(`${tunnel.name}: ${publicUrl}`);
            } catch (err: any) {
                tunnelSpinner.fail(`${tunnel.name}: ${err.message}`);
            }
        }

        if (activeTunnels.length === 0) {
            console.log(chalk.red("\nNo tunnels created"));
            process.exit(1);
        }

        console.log(chalk.cyan("\n─────────────────────────────────────────"));
        console.log(chalk.green(`  ${activeTunnels.length} tunnel(s) active`));
        console.log(chalk.cyan("─────────────────────────────────────────\n"));

        for (const t of activeTunnels) {
            console.log(`  ${chalk.white(t.name.padEnd(15))} ${chalk.green(t.publicUrl)}`);
        }

        console.log(chalk.gray("\n  Press Ctrl+C to stop all tunnels\n"));

        // Keep alive with uptime counter
        const startTime = Date.now();
        const statsInterval = setInterval(() => {
            const uptime = formatDuration(Date.now() - startTime);
            process.stdout.write(`\r  ${chalk.gray(`Uptime: ${uptime}`)}`);
        }, 1000);

        // Handle exit
        const cleanup = async () => {
            clearInterval(statsInterval);
            console.log("\n");
            const closeSpinner = ora("Closing tunnels...").start();

            for (const t of activeTunnels) {
                await client.closeTunnel(t.tunnelId);
            }

            await client.disconnect();
            closeSpinner.succeed("All tunnels closed");
            process.exit(0);
        };

        process.on("SIGINT", cleanup);
        process.on("SIGTERM", cleanup);

        // Handle reconnection
        client.on("disconnected", () => {
            console.log(chalk.yellow("\n  Disconnected, reconnecting..."));
        });

        client.on("connected", () => {
            console.log(chalk.green("  Reconnected!"));
        });

    } catch (err: any) {
        spinner.fail(`Failed: ${err.message}`);
        process.exit(1);
    }
};

async function runTunnelInBackground(command: string, port: string, options: any): Promise<void> {
    const { spawn } = await import("child_process");
    const fs = await import("fs");
    const path = await import("path");

    const tunnelId = `tunnel-${port}-${Date.now()}`;
    const pidFile = getPidFilePath(`tunnel-${port}`);
    const logFile = getLogFilePath(`tunnel-${port}`);

    // Check if already running
    if (fs.existsSync(pidFile)) {
        const oldPid = fs.readFileSync(pidFile, "utf-8").trim();
        try {
            process.kill(parseInt(oldPid), 0);
            console.log(chalk.yellow(`Tunnel already running on port ${port} (PID: ${oldPid})`));
            console.log(chalk.gray(`Stop it with: kill ${oldPid}`));
            return;
        } catch {
            fs.unlinkSync(pidFile);
        }
    }

    // Build args without -d flag
    const args = [command, port];
    if (options.subdomain) args.push("-n", options.subdomain);
    if (options.server) args.push("-s", options.server);
    if (options.token) args.push("-t", options.token);
    if (options.host) args.push("-h", options.host);
    if (options.https) args.push("--https");
    if (options.ngrok) args.push("--ngrok");
    if (options.region) args.push("--region", options.region);
    if (options.remotePort) args.push("-r", options.remotePort);
    if (options.protocol) args.push("-p", options.protocol);

    const out = fs.openSync(logFile, "a");
    const err = fs.openSync(logFile, "a");

    const child = spawn(process.execPath, [process.argv[1], ...args], {
        detached: true,
        stdio: ["ignore", out, err],
        cwd: process.cwd(),
    });

    child.unref();
    fs.writeFileSync(pidFile, String(child.pid));

    // Extract domain from server URL for display
    const serverUrl = options.server || "ws://localhost:8080/_tunnel";
    let displayDomain = "localhost:8080";
    let expectedUrl = `http://${options.subdomain || "random"}.op.localhost:8080`;

    try {
        const url = new URL(serverUrl.replace("wss://", "https://").replace("ws://", "http://"));
        displayDomain = url.host;
        const isSecure = serverUrl.startsWith("wss://");
        const protocol = isSecure ? "https" : "http";
        const subdomain = options.subdomain || "<random>";
        expectedUrl = `${protocol}://${subdomain}.op.${url.hostname}`;
        if ((isSecure && url.port && url.port !== "443") || (!isSecure && url.port && url.port !== "80")) {
            expectedUrl += `:${url.port}`;
        }
    } catch {}

    console.log(chalk.green(`Tunnel started in background`));
    console.log(chalk.gray("  ─────────────────────────────────────────"));
    console.log(`  ${chalk.white("PID:")}       ${chalk.cyan(child.pid)}`);
    console.log(`  ${chalk.white("Local:")}     ${chalk.gray(`localhost:${port}`)}`);
    console.log(`  ${chalk.white("Server:")}    ${chalk.gray(displayDomain)}`);
    console.log(`  ${chalk.white("Public:")}    ${chalk.green(expectedUrl)} ${chalk.yellow("(pending)")}`);
    console.log(chalk.gray("  ─────────────────────────────────────────"));
    console.log(chalk.gray(`  Log: ${logFile}`));
    console.log("");
    console.log(chalk.gray(`Stop with:  kill ${child.pid}`));
    console.log(chalk.gray(`Check:      tail -f ${logFile}`));
};

interface TunnelOptions {
    protocol: TunnelProtocol;
    localHost: string;
    localPort: number;
    subdomain?: string;
    remotePort?: number;
    serverUrl: string;
    token?: string;
    insecure?: boolean; // Skip SSL verification for self-signed certs
}

interface NgrokOptions {
    protocol: TunnelProtocol;
    localHost: string;
    localPort: number;
    subdomain?: string;
    remotePort?: number;
    authtoken?: string;
    region?: string;
}

async function createTunnel(options: TunnelOptions): Promise<void> {
    const spinner = ora("Connecting to server...").start();

    const client = new TunnelClient({
        serverUrl: options.serverUrl,
        token: options.token,
        reconnect: true,
        silent: true,
        rejectUnauthorized: !options.insecure,
    });

    try {
        await client.connect();
        spinner.text = "Creating tunnel...";

        const { tunnelId, publicUrl } = await client.createTunnel({
            protocol: options.protocol,
            localHost: options.localHost,
            localPort: options.localPort,
            subdomain: options.subdomain,
            remotePort: options.remotePort,
        });

        spinner.succeed("Tunnel established!");

        printTunnelInfo({
            status: "Online",
            protocol: options.protocol,
            localHost: options.localHost,
            localPort: options.localPort,
            publicUrl,
            provider: "OpenTunnel",
        });

        // Keep alive
        const startTime = Date.now();
        const statsInterval = setInterval(() => {
            const uptime = formatDuration(Date.now() - startTime);
            process.stdout.write(`\r  ${chalk.gray(`Uptime: ${uptime}`)}`);
        }, 1000);

        // Handle exit
        const cleanup = async () => {
            clearInterval(statsInterval);
            console.log("\n");
            spinner.start("Closing tunnel...");
            await client.closeTunnel(tunnelId);
            await client.disconnect();
            spinner.succeed("Tunnel closed");
            process.exit(0);
        };

        process.on("SIGINT", cleanup);
        process.on("SIGTERM", cleanup);

        // Handle reconnection
        client.on("disconnected", () => {
            console.log(chalk.yellow("\n  Disconnected, reconnecting..."));
        });

        client.on("connected", () => {
            console.log(chalk.green("  Reconnected!"));
        });

    } catch (err: any) {
        spinner.fail(`Failed: ${err.message}`);
        process.exit(1);
    }
};

async function createNgrokTunnel(options: NgrokOptions): Promise<void> {
    const spinner = ora("Starting ngrok...").start();

    const client = new NgrokClient({
        authtoken: options.authtoken,
        region: options.region as any,
    });

    try {
        await client.connect();
        spinner.text = "Creating tunnel...";

        const { tunnelId, publicUrl } = await client.createTunnel({
            protocol: options.protocol,
            localHost: options.localHost,
            localPort: options.localPort,
            subdomain: options.subdomain,
            remotePort: options.remotePort,
        });

        spinner.succeed("Tunnel established!");

        printTunnelInfo({
            status: "Online",
            protocol: options.protocol,
            localHost: options.localHost,
            localPort: options.localPort,
            publicUrl,
            provider: "ngrok",
        });

        // Keep alive
        const startTime = Date.now();
        const statsInterval = setInterval(() => {
            const uptime = formatDuration(Date.now() - startTime);
            process.stdout.write(`\r  ${chalk.gray(`Uptime: ${uptime}`)}`);
        }, 1000);

        // Handle exit
        const cleanup = async () => {
            clearInterval(statsInterval);
            console.log("\n");
            spinner.start("Closing tunnel...");
            await client.closeTunnel(tunnelId);
            await client.disconnect();
            spinner.succeed("Tunnel closed");
            process.exit(0);
        };

        process.on("SIGINT", cleanup);
        process.on("SIGTERM", cleanup);

    } catch (err: any) {
        spinner.fail(`Failed: ${err.message}`);
        console.log(chalk.yellow("\nMake sure ngrok is installed: https://ngrok.com/download"));
        process.exit(1);
    }
};

function printTunnelInfo(info: {
    status: string;
    protocol: TunnelProtocol;
    localHost: string;
    localPort: number;
    publicUrl: string;
    provider: string;
}): void {
    console.log("");
    console.log(chalk.cyan(`  OpenTunnel ${chalk.gray(`(via ${info.provider})`)}`));
    console.log(chalk.gray("  ─────────────────────────────────────────"));
    console.log(`  ${chalk.white("Status:")}    ${chalk.green(`● ${info.status}`)}`);
    console.log(`  ${chalk.white("Protocol:")}  ${chalk.yellow(info.protocol.toUpperCase())}`);
    console.log(`  ${chalk.white("Local:")}     ${chalk.gray(`${info.localHost}:${info.localPort}`)}`);
    console.log(`  ${chalk.white("Public:")}    ${chalk.green(info.publicUrl)}`);
    console.log(chalk.gray("  ─────────────────────────────────────────"));
    console.log("");
    console.log(chalk.gray("  Press Ctrl+C to close the tunnel"));
    console.log("");
};

program.parse();