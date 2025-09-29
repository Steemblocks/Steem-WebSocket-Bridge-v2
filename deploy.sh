#!/bin/bash

# Steem WebSocket Bridge - Docker Deployment Script
# Domain: dhakawitness.com

echo "Building Steem WebSocket Bridge for dhakawitness.com"

# Build Docker image
docker build -t steem-websocket-bridge:latest .

echo "Docker image built successfully"

# Stop existing container if running
if [ "$(docker ps -q -f name=steem-bridge)" ]; then
    echo "Stopping existing container..."
    docker stop steem-bridge
fi

# Remove existing container if exists
if [ "$(docker ps -aq -f name=steem-bridge)" ]; then
    echo "Removing existing container..."
    docker rm steem-bridge
fi

# Run new container
echo "Starting new container on dhakawitness.com..."
docker run -d \
    --name steem-bridge \
    --restart unless-stopped \
    -p 8080:8080 \
    -e NODE_ENV=production \
    -e PORT=8080 \
    --health-cmd="curl -f http://localhost:8080/health || exit 1" \
    --health-interval=30s \
    --health-timeout=10s \
    --health-retries=3 \
    --health-start-period=10s \
    steem-websocket-bridge:latest

echo "Container started successfully"
echo ""
echo "Container status:"
docker ps -f name=steem-bridge

echo ""
echo "Health check:"
sleep 5
docker exec steem-bridge curl -f http://localhost:8080/health

echo ""
echo "Service status:"
docker exec steem-bridge curl -s http://localhost:8080/status | head -20

echo ""
echo "Production URLs:"
echo "   Health: https://dhakawitness.com/health"
echo "   Status: https://dhakawitness.com/status" 
echo "   WebSocket: wss://dhakawitness.com"
echo ""
echo "View logs:"
echo "   docker logs -f steem-bridge"
echo ""
echo "Deployment complete!"