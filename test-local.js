#!/usr/bin/env node

/**
 * OpenTunnel Local Test Script
 * ============================
 * Tests the tunnel system locally without external dependencies.
 *
 * Usage: node test-local.js
 */

const http = require("http");
const { spawn, execSync } = require("child_process");
const path = require("path");

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function waitForServer(url, maxAttempts = 10) {
    for (let i = 0; i < maxAttempts; i++) {
        try {
            await httpGet(url);
            return true;
        } catch {
            await sleep(500);
        }
    }
    return false;
}

const colors = {
    reset: "\x1b[0m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    cyan: "\x1b[36m",
    red: "\x1b[31m",
    gray: "\x1b[90m"
};

function log(color, ...args) {
    console.log(color, ...args, colors.reset);
};

function logSection(title) {
    console.log("");
    log(colors.cyan, `[${ title }]`);
    log(colors.gray, "─".repeat(50));
};

async function httpGet(url, headers = {}) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port || 80,
            path: urlObj.pathname + urlObj.search,
            method: "GET",
            headers,
            timeout: 5000
        };

        const req = http.request(options, (res) => {
            let data = "";
            res.on("data", chunk => data += chunk);
            res.on("end", () => resolve({ status: res.statusCode, data, headers: res.headers }));
        });

        req.on("error", reject);
        req.on("timeout", () => {
            req.destroy();
            reject(new Error("Request timeout"));
        });
        req.end();
    });
};

async function runCommand(cmd, args, options = {}) {
    return new Promise((resolve, reject) => {
        const proc = spawn(cmd, args, {
            stdio: options.silent ? "pipe" : "inherit",
            shell: true,
            ...options
        });

        let stdout = "";
        let stderr = "";

        if (options.silent) {
            proc.stdout?.on("data", d => stdout += d);
            proc.stderr?.on("data", d => stderr += d);
        }

        proc.on("close", code => {
            if (code === 0) resolve({ stdout, stderr });
            else reject(new Error(`Command failed with code ${code}: ${stderr}`));
        });
        proc.on("error", reject);
    });
};

async function main() {
    console.log("");
    log(colors.cyan, "╔══════════════════════════════════════════════════╗");
    log(colors.cyan, "║         OpenTunnel Local Test Suite              ║");
    log(colors.cyan, "╚══════════════════════════════════════════════════╝");

    const cliPath = path.join(__dirname, "dist", "cli", "index.js");
    let testsPassed = 0;
    let testsFailed = 0;

    try {
        // 1. Build
        logSection("1. Building project");
        try {
            execSync("npm run build", { stdio: "inherit", cwd: __dirname });
            log(colors.green, "✓ Build successful");
            testsPassed++;
        } catch {
            log(colors.red, "✗ Build failed");
            testsFailed++;
            process.exit(1);
        }

        // 2. Start test server
        logSection("2. Starting test HTTP server (port 5000)");
        await runCommand("node", [cliPath, "test-server", "-p", "5000", "-d"], { silent: true });

        log(colors.gray, "  Waiting for test server...");
        if (await waitForServer("http://localhost:5000", 15)) {
            log(colors.green, "✓ Test server running");
            testsPassed++;
        } else {
            log(colors.red, "✗ Test server failed to start");
            testsFailed++;
        }

        // 3. Start tunnel server
        logSection("3. Starting tunnel server (port 8080)");
        await runCommand("node", [cliPath, "server", "--domain", "localhost", "-d"], { silent: true });

        log(colors.gray, "  Waiting for tunnel server...");
        if (await waitForServer("http://localhost:8080", 15)) {
            try {
                const res = await httpGet("http://localhost:8080");
                const data = JSON.parse(res.data);
                log(colors.green, `✓ Tunnel server running`);
                log(colors.gray, `  Domain: ${data.domain}`);
                log(colors.gray, `  Pattern: ${data.subdomainPattern}`);
                testsPassed++;
            } catch (err) {
                log(colors.red, `✗ Tunnel server response error: ${err.message}`);
                testsFailed++;
            }
        } else {
            log(colors.red, "✗ Tunnel server failed to start");
            testsFailed++;
        }

        // 4. Create tunnel
        logSection("4. Creating HTTP tunnel (localhost:5000 → test.op.localhost)");
        await runCommand("node", [cliPath, "http", "5000", "-n", "test", "-d"], { silent: true });
        await sleep(5000); // Give tunnel time to establish

        // 5. Test tunnel via Host header
        logSection("5. Testing tunnel connection");
        try {
            const res = await httpGet("http://localhost:8080", { Host: "test.op.localhost" });
            if (res.status === 200) {
                const data = JSON.parse(res.data);
                log(colors.green, "✓ Tunnel working!");
                log(colors.gray, `  Response from: ${data.server?.port || "test server"}`);
                testsPassed++;
            } else {
                throw new Error(`Status ${res.status}`);
            }
        } catch (err) {
            log(colors.red, `✗ Tunnel test failed: ${err.message}`);
            log(colors.yellow, "  Note: This may be expected if tunnel is still connecting");
            testsFailed++;
        }

        // 6. Check ps command
        logSection("6. Checking running processes");
        await runCommand("node", [cliPath, "ps"]);
        testsPassed++;

        // 7. Test API endpoints
        logSection("7. Testing API endpoints");
        try {
            const statsRes = await httpGet("http://localhost:8080/api/stats");
            const stats = JSON.parse(statsRes.data);
            log(colors.green, `✓ /api/stats working`);
            log(colors.gray, `  Clients: ${stats.clients}, Tunnels: ${stats.tunnels}`);
            testsPassed++;
        } catch (err) {
            log(colors.red, `✗ API stats failed: ${err.message}`);
            testsFailed++;
        }

        try {
            const tunnelsRes = await httpGet("http://localhost:8080/api/tunnels");
            const tunnels = JSON.parse(tunnelsRes.data);
            log(colors.green, `✓ /api/tunnels working`);
            log(colors.gray, `  Active tunnels: ${tunnels.tunnels?.length || 0}`);
            if (tunnels.tunnels?.length > 0) {
                tunnels.tunnels.forEach(t => {
                    log(colors.gray, `    - ${t.publicUrl}`);
                });
            }
            testsPassed++;
        } catch (err) {
            log(colors.red, `✗ API tunnels failed: ${err.message}`);
            testsFailed++;
        }

    } finally {
        // Cleanup
        logSection("Cleanup");
        try {
            await runCommand("node", [cliPath, "down"], { silent: true });
            await runCommand("node", [cliPath, "test-server-stop"], { silent: true });
            log(colors.green, "✓ All processes stopped");
        } catch {
            log(colors.yellow, "Some processes may still be running");
        }
    }

    // Summary
    console.log("");
    log(colors.cyan, "╔══════════════════════════════════════════════════╗");
    log(colors.cyan, "║                  Test Results                     ║");
    log(colors.cyan, "╚══════════════════════════════════════════════════╝");
    console.log("");
    log(colors.green, `  ✓ Passed: ${testsPassed}`);
    if (testsFailed > 0) {
        log(colors.red, `  ✗ Failed: ${testsFailed}`);
    }
    console.log("");

    if (testsFailed === 0) {
        log(colors.green, "All tests passed! The tunnel system is working correctly.");
    } else {
        log(colors.yellow, "Some tests failed. Check the output above for details.");
    }

    console.log("");
    log(colors.gray, "To test manually:");
    log(colors.gray, "  1. node dist/cli/index.js server --domain localhost");
    log(colors.gray, "  2. node dist/cli/index.js test-server -p 5000");
    log(colors.gray, "  3. node dist/cli/index.js http 5000 -n myapp");
    log(colors.gray, "  4. curl -H 'Host: myapp.op.localhost' http://localhost:8080");
    console.log("");

    process.exit(testsFailed > 0 ? 1 : 0);
};

main().catch(err => {
    log(colors.red, "Test script error:", err.message);
    process.exit(1);
});
