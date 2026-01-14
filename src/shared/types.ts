// Tunnel types
export type TunnelProtocol = "http" | "https" | "tcp" | "udp";

export interface TunnelConfig {
    id: string;
    protocol: TunnelProtocol;
    localHost: string;
    localPort: number;
    remotePort?: number;
    subdomain?: string;
    customDomain?: string;
    auth?: {
        username: string;
        password: string;
    };
}

export interface TunnelInfo {
    id: string;
    protocol: TunnelProtocol;
    localAddress: string;
    publicUrl: string;
    createdAt: Date;
    bytesIn: number;
    bytesOut: number;
    connections: number;
}

// WebSocket message types
export type MessageType =
    | "auth"
    | "auth_response"
    | "tunnel_request"
    | "tunnel_response"
    | "tunnel_close"
    | "http_request"
    | "http_response"
    | "tcp_data"
    | "tcp_close"
    | "ping"
    | "pong"
    | "error";

export interface BaseMessage {
    type: MessageType;
    id: string;
    timestamp: number;
}

export interface AuthMessage extends BaseMessage {
    type: "auth";
    token?: string;
}

export interface AuthResponseMessage extends BaseMessage {
    type: "auth_response";
    success: boolean;
    clientId?: string;
    error?: string;
}

export interface TunnelRequestMessage extends BaseMessage {
    type: "tunnel_request";
    config: TunnelConfig;
}

export interface TunnelResponseMessage extends BaseMessage {
    type: "tunnel_response";
    success: boolean;
    tunnelId?: string;
    publicUrl?: string;
    error?: string;
}

export interface TunnelCloseMessage extends BaseMessage {
    type: "tunnel_close";
    tunnelId: string;
}

export interface HttpRequestMessage extends BaseMessage {
    type: "http_request";
    tunnelId: string;
    requestId: string;
    method: string;
    path: string;
    headers: Record<string, string | string[] | undefined>;
    body?: string;
}

export interface HttpResponseMessage extends BaseMessage {
    type: "http_response";
    tunnelId: string;
    requestId: string;
    statusCode: number;
    headers: Record<string, string | string[] | undefined>;
    body?: string;
    isBase64?: boolean; // True if body is base64 encoded (for binary data like gzip)
}

export interface TcpDataMessage extends BaseMessage {
    type: "tcp_data";
    tunnelId: string;
    connectionId: string;
    data: string; // base64 encoded
}

export interface TcpCloseMessage extends BaseMessage {
    type: "tcp_close";
    tunnelId: string;
    connectionId: string;
}

export interface ErrorMessage extends BaseMessage {
    type: "error";
    error: string;
    code?: string;
}

export type Message =
    | AuthMessage
    | AuthResponseMessage
    | TunnelRequestMessage
    | TunnelResponseMessage
    | TunnelCloseMessage
    | HttpRequestMessage
    | HttpResponseMessage
    | TcpDataMessage
    | TcpCloseMessage
    | ErrorMessage
    | BaseMessage;

// IP Access Control types
export type IpAccessMode = "all" | "allowlist" | "denylist";

export interface IpAccessConfig {
    mode: IpAccessMode;           // "all" = allow everyone, "allowlist" = only allow listed, "denylist" = deny listed
    allowList?: string[];         // IPs or CIDR ranges to allow (e.g., ["192.168.1.0/24", "10.0.0.1"])
    denyList?: string[];          // IPs or CIDR ranges to deny
}

// Server configuration
export interface ServerConfig {
    port: number;
    publicPort?: number; // Port shown in public URLs (default: same as port)
    host: string;
    domain: string;
    basePath: string;
    https?: {
        cert: string;
        key: string;
    };
    // Self-signed certificates (local/development)
    selfSignedHttps?: {
        enabled: boolean;
        certsDir?: string;
    };
    autoHttps?: {
        enabled: boolean;
        email: string;
        production: boolean;
        certsDir?: string;
        cloudflareToken?: string;
    };
    auth?: {
        required: boolean;
        tokens: string[];
    };
    // IP-based access control
    ipAccess?: IpAccessConfig;
    duckdns?: {
        token: string;
        domain: string;
    };
    // Automatic DNS management
    autoDns?: {
        enabled: boolean;
        provider: "cloudflare" | "duckdns";
        cloudflareToken?: string;
        duckdnsToken?: string;
        // Create individual records for each tunnel (vs relying on wildcard)
        createRecords?: boolean;
        // Delete records when tunnel closes
        deleteOnClose?: boolean;
        // Setup wildcard and base DNS records on startup
        setupWildcard?: boolean;
    };
    tunnelPortRange: {
        min: number;
        max: number;
    };
}

// Client configuration
export interface ClientConfig {
    serverUrl: string;
    token?: string;
    reconnect: boolean;
    reconnectInterval: number;
    silent: boolean;
    rejectUnauthorized?: boolean; // Set to false for self-signed certificates
}

// DNS Provider types
export interface DnsProvider {
    name: string;
    updateRecord(subdomain: string, ip: string): Promise<boolean>;
    deleteRecord(subdomain: string): Promise<boolean>;
}
