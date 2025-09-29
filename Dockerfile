# Dockerfile for Steem WebSocket Bridge
FROM node:22-alpine

# Install curl for health checks
RUN apk add --no-cache curl

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy application files
COPY steem-bridge.js ./
COPY steem-client.js ./

# Create non-root user for security
RUN addgroup -g 1001 -S steem && \
    adduser -S steem -u 1001 -G steem

# Change ownership of app directory
RUN chown -R steem:steem /app

# Switch to non-root user
USER steem

# Expose port (configurable via environment)
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

# Start the application
CMD ["node", "steem-bridge.js"]
