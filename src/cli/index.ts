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

interface OpenTunnelConfig {
    version: string;
    server?: {
        domain?: string;   // Run local server with this domain
        remote?: string;   // Connect to remote server (e.g., "op.fjrg2007.com")
        port?: number;
        basePath?: string;
        https?: boolean;
        token?: string;
        tcpPortMin?: number;
        tcpPortMax?: number;
    };
    tunnels: TunnelConfigYaml[];
}

const CONFIG_FILE = "opentunnel.yml";
const program = new Command();

program
    .name("opentunnel")
    .alias("ot")
    .description("Expose local ports to the internet via custom domains or ngrok")
    .version("1.0.0");

// Helper function to build WebSocket URL from hostname
function buildServerUrl(server: string, insecure: boolean): { url: string; displayName: string } {
    let hostname = server;

    // Remove protocol if provided
    hostname = hostname.replace(/^(wss?|https?):\/\//, "");
    // Remove trailing path
    hostname = hostname.replace(/\/_tunnel.*$/, "");
    // Remove trailing slash
    hostname = hostname.replace(/\/$/, "");

    const protocol = insecure ? "ws" : "wss";
    return {
        url: `${protocol}://${hostname}/_tunnel`,
        displayName: hostname,
    };
}

// Quick command - quick tunnel to any server
program
    .command("quick <port>")
    .description("Instantly expose a local port to the internet")
    .requiredOption("-s, --server <host>", "Server hostname (e.g., op.example.com)")
    .option("-n, --subdomain <name>", "Request a specific subdomain (e.g., 'myapp')")
    .option("-p, --protocol <proto>", "Protocol (http, https, tcp)", "http")
    .option("-h, --host <host>", "Local host to forward to", "localhost")
    .option("-t, --token <token>", "Authentication token (if server requires it)")
    .option("--insecure", "Skip SSL certificate verification (for self-signed certs)")
    .action(async (port: string, options) => {
        // Build server URL from hostname
        const { url: serverUrl, displayName: serverDisplayName } = buildServerUrl(options.server, options.insecure);

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

        try {
            const client = new TunnelClient({
                serverUrl,
                token: options.token,
                reconnect: true,
                silent: true,
                rejectUnauthorized: !options.insecure,
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
            console.log(chalk.cyan(`  OpenTunnel ${chalk.gray(`(via ${serverDisplayName})`)}`));
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
            console.log(chalk.gray("  - The public server may be temporarily unavailable"));
            console.log(chalk.gray("  - Try hosting your own server: opentunnel server --domain yourdomain.com"));
            console.log("");
            process.exit(1);
        }
    });

// HTTP tunnel command
program
    .command("http <port>")
    .description("Expose a local HTTP server")
    .option("-s, --server <host>", "Remote server hostname (if not provided, starts local server)")
    .option("-t, --token <token>", "Authentication token")
    .option("-n, --subdomain <name>", "Custom subdomain (e.g., 'myapp' for myapp.op.domain.com)")
    .option("-d, --detach", "Run tunnel in background")
    .option("-h, --host <host>", "Local host", "localhost")
    .option("--domain <domain>", "Domain for the tunnel", "localhost")
    .option("--port <port>", "Server port", "443")
    .option("--base-path <path>", "Subdomain base path", "op")
    .option("--https", "Use HTTPS for local connection")
    .option("--insecure", "Skip SSL verification (for self-signed certs)")
    .option("--ngrok", "Use ngrok instead of OpenTunnel server")
    .option("--region <region>", "Ngrok region (us, eu, ap, au, sa, jp, in)", "us")
    .action(async (port: string, options) => {
        if (options.ngrok || options.server === "ngrok") {
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

        // If remote server hostname provided, just connect to it
        if (options.server) {
            const { url: serverUrl } = buildServerUrl(options.server, options.insecure);
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

        // Start local server + tunnel (all-in-one)
        const { TunnelServer } = await import("../server/TunnelServer");

        const serverPort = parseInt(options.port);
        const domain = options.domain;
        const basePath = options.basePath;
        const subdomain = options.subdomain || "app";

        console.log(chalk.cyan(`
 ██████╗ ██████╗ ███████╗███╗   ██╗████████╗██╗   ██╗███╗   ██╗███╗   ██╗███████╗██╗
██╔═══██╗██╔══██╗██╔════╝████╗  ██║╚══██╔══╝██║   ██║████╗  ██║████╗  ██║██╔════╝██║
██║   ██║██████╔╝█████╗  ██╔██╗ ██║   ██║   ██║   ██║██╔██╗ ██║██╔██╗ ██║█████╗  ██║
██║   ██║██╔═══╝ ██╔══╝  ██║╚██╗██║   ██║   ██║   ██║██║╚██╗██║██║╚██╗██║██╔══╝  ██║
╚██████╔╝██║     ███████╗██║ ╚████║   ██║   ╚██████╔╝██║ ╚████║██║ ╚████║███████╗███████╗
 ╚═════╝ ╚═╝     ╚══════╝╚═╝  ╚═══╝   ╚═╝    ╚═════╝ ╚═╝  ╚═══╝╚═╝  ╚═══╝╚══════╝╚══════╝
`));

        const spinner = ora("Starting server...").start();

        const server = new TunnelServer({
            port: serverPort,
            host: "0.0.0.0",
            domain,
            basePath,
            tunnelPortRange: { min: 10000, max: 20000 },
            selfSignedHttps: { enabled: true },
        });

        try {
            await server.start();
            spinner.succeed(`Server running on port ${serverPort}`);

            // Connect tunnel
            const tunnelSpinner = ora("Creating tunnel...").start();
            await new Promise(resolve => setTimeout(resolve, 500));

            const serverUrl = `wss://localhost:${serverPort}/_tunnel`;

            await createTunnel({
                protocol: options.https ? "https" : "http",
                localHost: options.host,
                localPort: parseInt(port),
                subdomain,
                serverUrl,
                token: options.token,
                insecure: true,
            });

        } catch (error: any) {
            spinner.fail(`Failed: ${error.message}`);
            process.exit(1);
        }
    });

// TCP tunnel command
program
    .command("tcp <port>")
    .description("Expose a local TCP server")
    .option("-s, --server <host>", "Remote server hostname (if not provided, starts local server)")
    .option("-t, --token <token>", "Authentication token")
    .option("-r, --remote-port <port>", "Remote port to use")
    .option("-h, --host <host>", "Local host", "localhost")
    .option("--domain <domain>", "Domain for the tunnel", "localhost")
    .option("--port <port>", "Server port", "443")
    .option("--insecure", "Skip SSL verification (for self-signed certs)")
    .option("--ngrok", "Use ngrok instead of OpenTunnel server")
    .option("--region <region>", "Ngrok region (us, eu, ap, au, sa, jp, in)", "us")
    .action(async (port: string, options) => {
        if (options.ngrok || options.server === "ngrok") {
            await createNgrokTunnel({
                protocol: "tcp",
                localHost: options.host,
                localPort: parseInt(port),
                remotePort: options.remotePort ? parseInt(options.remotePort) : undefined,
                authtoken: options.token,
                region: options.region,
            });
            return;
        }

        // If remote server hostname provided, just connect to it
        if (options.server) {
            const { url: serverUrl } = buildServerUrl(options.server, options.insecure);
            await createTunnel({
                protocol: "tcp",
                localHost: options.host,
                localPort: parseInt(port),
                remotePort: options.remotePort ? parseInt(options.remotePort) : undefined,
                serverUrl,
                token: options.token,
                insecure: options.insecure,
            });
            return;
        }

        // Start local server + tunnel (all-in-one)
        const { TunnelServer } = await import("../server/TunnelServer");

        const serverPort = parseInt(options.port);
        const domain = options.domain;

        console.log(chalk.cyan(`
 ██████╗ ██████╗ ███████╗███╗   ██╗████████╗██╗   ██╗███╗   ██╗███╗   ██╗███████╗██╗
██╔═══██╗██╔══██╗██╔════╝████╗  ██║╚══██╔══╝██║   ██║████╗  ██║████╗  ██║██╔════╝██║
██║   ██║██████╔╝█████╗  ██╔██╗ ██║   ██║   ██║   ██║██╔██╗ ██║██╔██╗ ██║█████╗  ██║
██║   ██║██╔═══╝ ██╔══╝  ██║╚██╗██║   ██║   ██║   ██║██║╚██╗██║██║╚██╗██║██╔══╝  ██║
╚██████╔╝██║     ███████╗██║ ╚████║   ██║   ╚██████╔╝██║ ╚████║██║ ╚████║███████╗███████╗
 ╚═════╝ ╚═╝     ╚══════╝╚═╝  ╚═══╝   ╚═╝    ╚═════╝ ╚═╝  ╚═══╝╚═╝  ╚═══╝╚══════╝╚══════╝
`));

        const spinner = ora("Starting server...").start();

        const server = new TunnelServer({
            port: serverPort,
            host: "0.0.0.0",
            domain,
            basePath: "op",
            tunnelPortRange: { min: 10000, max: 20000 },
            selfSignedHttps: { enabled: true },
        });

        try {
            await server.start();
            spinner.succeed(`Server running on port ${serverPort}`);

            const tunnelSpinner = ora("Creating TCP tunnel...").start();
            await new Promise(resolve => setTimeout(resolve, 500));

            const serverUrl = `wss://localhost:${serverPort}/_tunnel`;

            await createTunnel({
                protocol: "tcp",
                localHost: options.host,
                localPort: parseInt(port),
                remotePort: options.remotePort ? parseInt(options.remotePort) : undefined,
                serverUrl,
                token: options.token,
                insecure: true,
            });

        } catch (error: any) {
            spinner.fail(`Failed: ${error.message}`);
            process.exit(1);
        }
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
                authtoken: options.token,
            });
        } else {
            await createTunnel({
                protocol: options.protocol as TunnelProtocol,
                localHost: "localhost",
                localPort: parseInt(port),
                subdomain: options.subdomain,
                serverUrl,
                token: options.token,
                insecure: options.insecure,
            });
        }
    });

// Server command
program
    .command("server")
    .description("Start the OpenTunnel server (standalone mode)")
    .option("-p, --port <port>", "Server port", "443")
    .option("--public-port <port>", "Public port shown in URLs (default: same as port)")
    .option("--domain <domain>", "Base domain", "localhost")
    .option("-b, --base-path <path>", "Subdomain base path (e.g., 'op' for *.op.domain.com)", "op")
    .option("--host <host>", "Bind host", "0.0.0.0")
    .option("--tcp-min <port>", "Minimum TCP port", "10000")
    .option("--tcp-max <port>", "Maximum TCP port", "20000")
    .option("--auth-tokens <tokens>", "Comma-separated auth tokens")
    .option("--no-https", "Disable HTTPS (use plain HTTP)")
    .option("--https-cert <path>", "Path to SSL certificate (for custom certs)")
    .option("--https-key <path>", "Path to SSL private key (for custom certs)")
    .option("--letsencrypt", "Use Let's Encrypt instead of self-signed (requires port 80)")
    .option("--email <email>", "Email for Let's Encrypt notifications")
    .option("--production", "Use Let's Encrypt production (default: staging)")
    .option("--cloudflare-token <token>", "Cloudflare API token for DNS-01 challenge")
    .option("--duckdns-token <token>", "DuckDNS token for dynamic DNS updates")
    .option("-d, --detach", "Run server in background (detached mode)")
    .action(async (options) => {
        // Detached mode - run in background
        if (options.detach) {
            const { spawn } = await import("child_process");
            const fs = await import("fs");
            const path = await import("path");

            const pidFile = path.join(process.cwd(), ".opentunnel.pid");
            const logFile = path.join(process.cwd(), "opentunnel.log");

            // Check if already running
            if (fs.existsSync(pidFile)) {
                const oldPid = fs.readFileSync(pidFile, "utf-8").trim();
                try {
                    process.kill(parseInt(oldPid), 0);
                    console.log(chalk.yellow(`Server already running (PID: ${oldPid})`));
                    console.log(chalk.gray(`Stop it with: opentunnel stop`));
                    return;
                } catch {
                    fs.unlinkSync(pidFile);
                }
            }

            // Build args without -d flag
            const args = ["server"];
            if (options.port) args.push("-p", options.port);
            if (options.publicPort) args.push("--public-port", options.publicPort);
            if (options.domain) args.push("--domain", options.domain);
            if (options.basePath) args.push("-b", options.basePath);
            if (options.host) args.push("--host", options.host);
            if (options.tcpMin) args.push("--tcp-min", options.tcpMin);
            if (options.tcpMax) args.push("--tcp-max", options.tcpMax);
            if (options.authTokens) args.push("--auth-tokens", options.authTokens);
            if (options.https) args.push("--https");
            if (options.email) args.push("--email", options.email);
            if (options.production) args.push("--production");
            if (options.cloudflareToken) args.push("--cloudflare-token", options.cloudflareToken);
            if (options.duckdnsToken) args.push("--duckdns-token", options.duckdnsToken);
            if (options.autoDns) args.push("--auto-dns");
            if (options.dnsCreateRecords) args.push("--dns-create-records");
            if (options.dnsDeleteOnClose) args.push("--dns-delete-on-close");

            const out = fs.openSync(logFile, "a");
            const err = fs.openSync(logFile, "a");

            const child = spawn(process.execPath, [process.argv[1], ...args], {
                detached: true,
                stdio: ["ignore", out, err],
                cwd: process.cwd(),
            });

            child.unref();
            fs.writeFileSync(pidFile, String(child.pid));

            console.log(chalk.green(`OpenTunnel server started in background`));
            console.log(chalk.gray(`  PID:      ${child.pid}`));
            console.log(chalk.gray(`  Port:     ${options.port}`));
            console.log(chalk.gray(`  Domain:   ${options.domain}`));
            console.log(chalk.gray(`  Log:      ${logFile}`));
            console.log(chalk.gray(`  PID file: ${pidFile}`));
            console.log("");
            console.log(chalk.gray(`Stop with:  node dist/cli/index.js stop`));
            console.log(chalk.gray(`Logs:       tail -f ${logFile}`));
            return;
        }

        // Normal foreground mode
        const { TunnelServer } = await import("../server/TunnelServer");

        // Determine HTTPS configuration (self-signed enabled by default)
        let httpsConfig = undefined;
        let selfSignedHttpsConfig = undefined;
        let autoHttpsConfig = undefined;

        if (options.httpsCert && options.httpsKey) {
            // Custom certificates provided
            const fs = await import("fs");
            httpsConfig = {
                cert: fs.readFileSync(options.httpsCert, "utf-8"),
                key: fs.readFileSync(options.httpsKey, "utf-8"),
            };
        } else if (options.letsencrypt) {
            // Let's Encrypt
            autoHttpsConfig = {
                enabled: true,
                email: options.email || `admin@${options.domain}`,
                production: options.production || false,
                cloudflareToken: options.cloudflareToken,
            };
        } else {
            // Self-signed by default (use --no-https to disable)
            selfSignedHttpsConfig = {
                enabled: options.https !== false,
            };
        }

        const server = new TunnelServer({
            port: parseInt(options.port),
            publicPort: options.publicPort ? parseInt(options.publicPort) : undefined,
            host: options.host,
            domain: options.domain,
            basePath: options.basePath,
            tunnelPortRange: {
                min: parseInt(options.tcpMin),
                max: parseInt(options.tcpMax),
            },
            auth: options.authTokens
                ? { required: true, tokens: options.authTokens.split(",") }
                : undefined,
            https: httpsConfig,
            selfSignedHttps: selfSignedHttpsConfig,
            autoHttps: autoHttpsConfig,
            autoDns: detectDnsConfig(options),
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
                    createRecords: opts.dnsCreateRecords !== false,
                    deleteOnClose: opts.dnsDeleteOnClose || false,
                    setupWildcard: true,
                };
            }

            if (opts.duckdnsToken || isDuckDnsDomain) {
                return {
                    enabled: true,
                    provider: "duckdns" as const,
                    duckdnsToken: opts.duckdnsToken,
                    createRecords: false, // DuckDNS doesn't support subdomains
                    deleteOnClose: false,
                    setupWildcard: false,
                };
            }

            // No auto DNS if no tokens provided
            if (opts.autoDns) {
                console.log(chalk.yellow("Warning: --auto-dns requires --cloudflare-token or --duckdns-token"));
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
        console.log(chalk.green(`\nServer running on ${options.host}:${options.port}`));
        console.log(chalk.gray(`Domain: ${options.domain}`));
        console.log(chalk.gray(`Subdomain pattern: *.${options.basePath}.${options.domain}`));
        console.log(chalk.gray(`TCP port range: ${options.tcpMin}-${options.tcpMax}\n`));
    });

// Stop command
program
    .command("stop")
    .description("Stop the OpenTunnel server running in background")
    .action(async () => {
        const fs = await import("fs");
        const path = await import("path");

        const pidFile = path.join(process.cwd(), ".opentunnel.pid");

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
            } else {
                console.log(chalk.red(`Failed to stop server: ${err.message}`));
            }
        }
    });

// Logs command
program
    .command("logs")
    .description("Show server logs")
    .option("-f, --follow", "Follow log output")
    .option("-n, --lines <n>", "Number of lines to show", "50")
    .action(async (options) => {
        const fs = await import("fs");
        const path = await import("path");
        const { spawn } = await import("child_process");

        const logFile = path.join(process.cwd(), "opentunnel.log");

        if (!fs.existsSync(logFile)) {
            console.log(chalk.yellow("No log file found"));
            return;
        }

        if (options.follow) {
            // Use tail -f on Unix or PowerShell on Windows
            const isWindows = process.platform === "win32";
            if (isWindows) {
                const child = spawn("powershell", ["-Command", `Get-Content -Path "${logFile}" -Tail ${options.lines} -Wait`], {
                    stdio: "inherit"
                });
                child.on("error", () => {
                    // Fallback: just read the file
                    console.log(fs.readFileSync(logFile, "utf-8"));
                });
            } else {
                spawn("tail", ["-f", "-n", options.lines, logFile], { stdio: "inherit" });
            }
        } else {
            const content = fs.readFileSync(logFile, "utf-8");
            const lines = content.split("\n");
            const lastLines = lines.slice(-parseInt(options.lines));
            console.log(lastLines.join("\n"));
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
    .action(async (options) => {
        const fs = await import("fs");
        const path = await import("path");

        const configPath = path.join(process.cwd(), CONFIG_FILE);

        if (fs.existsSync(configPath) && !options.force) {
            console.log(chalk.yellow(`Config file already exists: ${configPath}`));
            console.log(chalk.gray("Use --force to overwrite"));
            return;
        }

        const exampleConfig: OpenTunnelConfig = {
            version: "1.0",
            server: {
                domain: "localhost",
                // remote: "op.fjrg2007.com",  // Use this to connect to a remote server
                // token: "your-auth-token",
            },
            tunnels: [
                {
                    name: "web",
                    protocol: "http",
                    port: 3000,
                    subdomain: "web",
                    autostart: true,
                },
                {
                    name: "api",
                    protocol: "http",
                    port: 4000,
                    subdomain: "api",
                    autostart: true,
                },
                {
                    name: "database",
                    protocol: "tcp",
                    port: 5432,
                    autostart: false,
                },
            ],
        };

        fs.writeFileSync(configPath, stringifyYaml(exampleConfig, { indent: 2 }));
        console.log(chalk.green(`Created ${CONFIG_FILE}`));
        console.log(chalk.gray(`\nEdit the file to configure your tunnels, then run:`));
        console.log(chalk.cyan(`  opentunnel up      # Start all tunnels`));
        console.log(chalk.cyan(`  opentunnel up -d   # Start in background`));
    });

// Up command - start tunnels from config (like docker-compose up)
program
    .command("up")
    .description("Start server and tunnels from opentunnel.yml (like docker-compose up)")
    .option("-d, --detach", "Run in background (detached mode)")
    .option("-f, --file <path>", "Config file path", CONFIG_FILE)
    .option("--no-autostart", "Ignore autostart setting, start all tunnels")
    .action(async (options) => {
        const fs = await import("fs");
        const path = await import("path");

        // Load config file
        const configPath = path.join(process.cwd(), options.file);
        let config: OpenTunnelConfig = { version: "1.0", tunnels: [] };

        if (fs.existsSync(configPath)) {
            const configContent = fs.readFileSync(configPath, "utf-8");
            config = parseYaml(configContent);
        } else {
            console.log(chalk.red(`Config file not found: ${configPath}`));
            console.log(chalk.gray(`Run 'opentunnel init' to create one`));
            return;
        }

        const tunnelsToStart = options.autostart === false
            ? config.tunnels
            : config.tunnels?.filter(t => t.autostart !== false) || [];

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

        // Mode detection:
        // - "remote" specified -> client mode (connect to remote server)
        // - "domain" specified -> server mode (start local server + tunnels)
        const isClientMode = !!remote && hasTunnels;
        const isServerMode = !!domain;

        if (!domain && !remote) {
            console.log(chalk.red("Missing configuration."));
            console.log(chalk.gray("\nAdd to your config:"));
            console.log(chalk.cyan("\n  # Run your own server:"));
            console.log(chalk.white("  server:"));
            console.log(chalk.white("    domain: localhost"));
            console.log(chalk.cyan("\n  # Or connect to a remote server:"));
            console.log(chalk.white("  server:"));
            console.log(chalk.white("    remote: op.fjrg2007.com"));
            process.exit(1);
        }

        if (isClientMode) {
            // CLIENT MODE: Connect to remote server
            const protocol = useHttps ? "wss" : "ws";
            const serverUrl = `${protocol}://${remote}/_tunnel`;

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
        } else if (isServerMode) {
            // SERVER MODE: Start local server (always when domain is specified)
            const { TunnelServer } = await import("../server/TunnelServer");

            const tcpMin = config.server?.tcpPortMin || 10000;
            const tcpMax = config.server?.tcpPortMax || 20000;

            const spinner = ora("Starting server...").start();

            const server = new TunnelServer({
                port,
                host: "0.0.0.0",
                domain,
                basePath,
                tunnelPortRange: {
                    min: tcpMin,
                    max: tcpMax,
                },
                selfSignedHttps: useHttps ? { enabled: true } : undefined,
            });

            try {
                await server.start();
                spinner.succeed(`Server running on https://${basePath}.${domain}:${port}`);

                // Start tunnels if defined
                if (hasTunnels) {
                    console.log(chalk.cyan(`\nStarting ${tunnelsToStart.length} tunnel(s)...\n`));

                    const wsProtocol = useHttps ? "wss" : "ws";
                    const serverUrl = `${wsProtocol}://localhost:${port}/_tunnel`;

                    // Small delay to ensure server is fully ready
                    await new Promise(resolve => setTimeout(resolve, 500));

                    await startTunnelsFromConfig(tunnelsToStart, serverUrl, config.server?.token, true);
                } else {
                    console.log(chalk.gray("\nServer ready. No tunnels defined."));
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

// Down command - stop all tunnels (like docker-compose down)
program
    .command("down")
    .description("Stop all running tunnels (like docker-compose down)")
    .action(async () => {
        const fs = await import("fs");
        const path = await import("path");

        // Find all tunnel PID files
        const pidFiles = fs.readdirSync(process.cwd())
            .filter(f => f.startsWith(".opentunnel-") && f.endsWith(".pid"));

        // Also include the server PID
        const serverPidFile = ".opentunnel.pid";
        if (fs.existsSync(path.join(process.cwd(), serverPidFile))) {
            pidFiles.push(serverPidFile);
        }

        if (pidFiles.length === 0) {
            console.log(chalk.yellow("No tunnels running"));
            return;
        }

        console.log(chalk.cyan(`Stopping ${pidFiles.length} process(es)...\n`));

        for (const pidFile of pidFiles) {
            const pidPath = path.join(process.cwd(), pidFile);
            const pid = parseInt(fs.readFileSync(pidPath, "utf-8").trim());
            const name = pidFile.replace(".opentunnel-", "").replace(".pid", "").replace(".opentunnel", "server");

            try {
                process.kill(pid, "SIGTERM");
                fs.unlinkSync(pidPath);
                console.log(chalk.green(`  ✓ Stopped ${name} (PID: ${pid})`));
            } catch (err: any) {
                if (err.code === "ESRCH") {
                    fs.unlinkSync(pidPath);
                    console.log(chalk.yellow(`  - ${name} was not running (cleaned up)`));
                } else {
                    console.log(chalk.red(`  ✗ Failed to stop ${name}: ${err.message}`));
                }
            }
        }

        // Clean up log files
        const logFiles = fs.readdirSync(process.cwd())
            .filter(f => f.startsWith("opentunnel") && f.endsWith(".log"));

        if (logFiles.length > 0) {
            console.log(chalk.gray(`\nLog files preserved: ${logFiles.join(", ")}`));
        }

        console.log(chalk.green("\nAll tunnels stopped"));
    });

// PS command - list running tunnel processes (like docker ps)
program
    .command("ps")
    .description("List running tunnel processes (like docker ps)")
    .action(async () => {
        const fs = await import("fs");
        const path = await import("path");

        const pidFiles = fs.readdirSync(process.cwd())
            .filter(f => f.startsWith(".opentunnel") && f.endsWith(".pid"));

        if (pidFiles.length === 0) {
            console.log(chalk.yellow("No tunnels running"));
            console.log(chalk.gray("Start tunnels with: opentunnel up -d"));
            return;
        }

        console.log(chalk.cyan("\nRunning Processes:"));
        console.log(chalk.gray("─".repeat(60)));
        console.log(chalk.gray(`  ${"NAME".padEnd(20)} ${"PID".padEnd(10)} ${"STATUS".padEnd(10)}`));
        console.log(chalk.gray("─".repeat(60)));

        for (const pidFile of pidFiles) {
            const pidPath = path.join(process.cwd(), pidFile);
            const pid = parseInt(fs.readFileSync(pidPath, "utf-8").trim());
            let name = pidFile.replace(".opentunnel-", "").replace(".pid", "").replace(".opentunnel", "");
            if (name === "") name = "server";

            let status = "unknown";
            let statusColor = chalk.gray;

            try {
                process.kill(pid, 0); // Check if process exists
                status = "running";
                statusColor = chalk.green;
            } catch {
                status = "stopped";
                statusColor = chalk.red;
            }

            console.log(`  ${chalk.white(name.padEnd(20))} ${chalk.gray(String(pid).padEnd(10))} ${statusColor(status)}`);
        }

        console.log(chalk.gray("─".repeat(60)));
        console.log(chalk.gray(`\nStop all: opentunnel down`));
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

            const pidFile = path.join(process.cwd(), `.test-server-${port}.pid`);
            const logFile = path.join(process.cwd(), `test-server-${port}.log`);

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
                        body: body || undefined,
                    },
                    server: {
                        port,
                        timestamp,
                        uptime: process.uptime(),
                    },
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
        const path = await import("path");

        let pidFiles: string[];

        if (options.port) {
            const specific = `.test-server-${options.port}.pid`;
            pidFiles = fs.existsSync(path.join(process.cwd(), specific)) ? [specific] : [];
        } else {
            pidFiles = fs.readdirSync(process.cwd())
                .filter(f => f.startsWith(".test-server-") && f.endsWith(".pid"));
        }

        if (pidFiles.length === 0) {
            console.log(chalk.yellow("No test servers running"));
            return;
        }

        for (const pidFile of pidFiles) {
            const pidPath = path.join(process.cwd(), pidFile);
            const pid = parseInt(fs.readFileSync(pidPath, "utf-8").trim());
            const port = pidFile.replace(".test-server-", "").replace(".pid", "");

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

    const pidFile = path.join(process.cwd(), `.opentunnel-${name}.pid`);
    const logFile = path.join(process.cwd(), `opentunnel-${name}.log`);

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
}

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
}

async function runTunnelInBackground(command: string, port: string, options: any): Promise<void> {
    const { spawn } = await import("child_process");
    const fs = await import("fs");
    const path = await import("path");

    const tunnelId = `tunnel-${port}-${Date.now()}`;
    const pidFile = path.join(process.cwd(), `.opentunnel-${port}.pid`);
    const logFile = path.join(process.cwd(), `opentunnel-${port}.log`);

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
}

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
}

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
}

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
}

program.parse();
