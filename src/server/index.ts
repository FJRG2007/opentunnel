#!/usr/bin/env node
import { TunnelServer } from "./TunnelServer";

const config = {
    port: parseInt(process.env.PORT || "8080"),
    host: process.env.HOST || "0.0.0.0",
    domain: process.env.DOMAIN || "localhost",
    basePath: process.env.BASE_PATH || "op",
    auth: process.env.AUTH_TOKENS
        ? {
              required: true,
              tokens: process.env.AUTH_TOKENS.split(","),
          }
        : undefined,
    duckdns: process.env.DUCKDNS_TOKEN
        ? {
              token: process.env.DUCKDNS_TOKEN,
              domain: process.env.DUCKDNS_DOMAIN || "",
          }
        : undefined,
    tunnelPortRange: {
        min: parseInt(process.env.TCP_PORT_MIN || "10000"),
        max: parseInt(process.env.TCP_PORT_MAX || "20000"),
    },
};

const server = new TunnelServer(config);

server.on("tunnel:created", ({ tunnelId, publicUrl }) => {
    console.log(`[Event] Tunnel created: ${tunnelId} -> ${publicUrl}`);
});

server.on("tunnel:closed", ({ tunnelId }) => {
    console.log(`[Event] Tunnel closed: ${tunnelId}`);
});

server.start().catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
});

// Graceful shutdown
process.on("SIGINT", async () => {
    console.log("\nShutting down...");
    await server.stop();
    process.exit(0);
});

process.on("SIGTERM", async () => {
    await server.stop();
    process.exit(0);
});
