/**
 * HTML page shown when the target application is not running
 */

export interface NotRunningPageOptions {
    host: string;
    port: number;
    provider?: string; // e.g., "Cloudflare Tunnel", "ngrok"
}

export function generateNotRunningPage(options: NotRunningPageOptions): string {
    const { host, port, provider } = options;

    const providerBadge = provider
        ? `<span class="provider">via ${provider}</span>`
        : "";

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>No Application Running - OpenTunnel</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #fff;
        }
        .container {
            text-align: center;
            padding: 40px;
            max-width: 600px;
        }
        .icon {
            font-size: 80px;
            margin-bottom: 20px;
            opacity: 0.8;
        }
        h1 {
            font-size: 28px;
            margin-bottom: 16px;
            color: #f39c12;
        }
        .message {
            font-size: 18px;
            color: #a0a0a0;
            margin-bottom: 30px;
            line-height: 1.6;
        }
        .port-info {
            background: rgba(255,255,255,0.1);
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 30px;
        }
        .port-info code {
            background: rgba(0,0,0,0.3);
            padding: 4px 12px;
            border-radius: 4px;
            font-family: 'Monaco', 'Menlo', monospace;
            color: #3498db;
            font-size: 16px;
        }
        .provider {
            display: inline-block;
            background: linear-gradient(135deg, #f48120 0%, #faad3f 100%);
            color: #fff;
            padding: 4px 12px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: 600;
            margin-bottom: 20px;
        }
        .footer {
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid rgba(255,255,255,0.1);
        }
        .footer a {
            color: #3498db;
            text-decoration: none;
            font-weight: 500;
        }
        .footer a:hover {
            text-decoration: underline;
        }
        .logo {
            font-size: 14px;
            color: #666;
            margin-top: 10px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon">⚡</div>
        ${providerBadge}
        <h1>No Application Running</h1>
        <p class="message">
            The tunnel is active, but there's no application listening on the local port.
        </p>
        <div class="port-info">
            <p style="margin-bottom: 10px; color: #888;">Expected application at:</p>
            <code>${host}:${port}</code>
        </div>
        <p class="message" style="font-size: 14px;">
            Start your application on port <strong>${port}</strong> and refresh this page.
        </p>
        <div class="footer">
            <p>Powered by <a href="https://github.com/FJRG2007/opentunnel" target="_blank">OpenTunnel</a></p>
            <p class="logo">Self-hosted tunnel solution</p>
        </div>
    </div>
</body>
</html>`;
}
