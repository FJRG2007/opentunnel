#!/bin/sh
set -e

# Build command arguments
ARGS="server --port ${PORT:-443} --host ${HOST:-0.0.0.0} --domain ${DOMAIN:-localhost} --base-path ${BASE_PATH:-op} --tcp-min ${TCP_PORT_MIN:-10000} --tcp-max ${TCP_PORT_MAX:-20000}"

# Add authentication if configured
if [ -n "$AUTH_TOKENS" ]; then
    ARGS="$ARGS --auth-tokens $AUTH_TOKENS"
fi

# Add Let's Encrypt if configured
if [ -n "$LETSENCRYPT_EMAIL" ]; then
    ARGS="$ARGS --letsencrypt --email $LETSENCRYPT_EMAIL"

    if [ "$LETSENCRYPT_PRODUCTION" = "true" ]; then
        ARGS="$ARGS --production"
    fi
fi

# Add Cloudflare if configured
if [ -n "$CLOUDFLARE_TOKEN" ]; then
    ARGS="$ARGS --cloudflare-token $CLOUDFLARE_TOKEN"
fi

echo "Starting OpenTunnel server..."
echo "Domain: ${DOMAIN:-localhost}"
echo "Port: ${PORT:-443}"
echo "Base path: ${BASE_PATH:-op}"

exec node dist/cli/index.js $ARGS
