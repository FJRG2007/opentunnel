FROM node:20-alpine

LABEL maintainer="FJRG2007"
LABEL description="OpenTunnel - Self-hosted tunnel server"

# Install dependencies for building native modules
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Remove dev dependencies and source files to reduce image size
RUN rm -rf src node_modules/.cache

# Create directory for certificates
RUN mkdir -p /app/.certs

# Copy entrypoint script
COPY deploy/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# Expose ports
# 443 - HTTPS server
# 80 - HTTP redirect / Let's Encrypt challenges
# 10000-20000 - TCP tunnel ports
EXPOSE 443 80
EXPOSE 10000-20000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT:-443}/api/stats || exit 1

# Default environment variables
ENV NODE_ENV=production
ENV PORT=443
ENV HOST=0.0.0.0
ENV DOMAIN=localhost
ENV BASE_PATH=op
ENV TCP_PORT_MIN=10000
ENV TCP_PORT_MAX=20000

# Run as non-root user for security
RUN addgroup -g 1001 -S opentunnel && \
    adduser -S opentunnel -u 1001 -G opentunnel && \
    chown -R opentunnel:opentunnel /app

USER opentunnel

# Start the server
ENTRYPOINT ["/app/docker-entrypoint.sh"]
