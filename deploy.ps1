# Steem WebSocket Bridge - Docker Deployment Script (Windows)
# Domain: dhakawitness.com

Write-Host "Building Steem WebSocket Bridge for dhakawitness.com" -ForegroundColor Green

# Build Docker image
Write-Host "Building Docker image..." -ForegroundColor Yellow
docker build -t steem-websocket-bridge:latest .

if ($LASTEXITCODE -eq 0) {
    Write-Host "Docker image built successfully" -ForegroundColor Green
} else {
    Write-Host "Failed to build Docker image" -ForegroundColor Red
    exit 1
}

# Stop existing container if running
Write-Host "Checking for existing container..." -ForegroundColor Yellow
$existingContainer = docker ps -q -f name=steem-bridge
if ($existingContainer) {
    Write-Host "Stopping existing container..." -ForegroundColor Yellow
    docker stop steem-bridge
}

# Remove existing container if exists
$existingContainer = docker ps -aq -f name=steem-bridge
if ($existingContainer) {
    Write-Host "Removing existing container..." -ForegroundColor Yellow
    docker rm steem-bridge
}

# Run new container
Write-Host "Starting new container on dhakawitness.com..." -ForegroundColor Green
docker run -d `
    --name steem-bridge `
    --restart unless-stopped `
    -p 8080:8080 `
    -e NODE_ENV=production `
    -e PORT=8080 `
    --health-cmd="curl -f http://localhost:8080/health || exit 1" `
    --health-interval=30s `
    --health-timeout=10s `
    --health-retries=3 `
    --health-start-period=10s `
    steem-websocket-bridge:latest

if ($LASTEXITCODE -eq 0) {
    Write-Host "Container started successfully" -ForegroundColor Green
} else {
    Write-Host "Failed to start container" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Container status:" -ForegroundColor Cyan
docker ps -f name=steem-bridge

Write-Host ""
Write-Host "Health check (waiting 5 seconds...):" -ForegroundColor Cyan
Start-Sleep -Seconds 5
docker exec steem-bridge curl -f http://localhost:8080/health

Write-Host ""
Write-Host "Service status:" -ForegroundColor Cyan
$status = docker exec steem-bridge curl -s http://localhost:8080/status
$status | ConvertFrom-Json | ConvertTo-Json -Depth 3

Write-Host ""
Write-Host "Production URLs:" -ForegroundColor Green
Write-Host "   Health: https://dhakawitness.com/health" -ForegroundColor White
Write-Host "   Status: https://dhakawitness.com/status" -ForegroundColor White
Write-Host "   WebSocket: wss://dhakawitness.com" -ForegroundColor White

Write-Host ""
Write-Host "Useful commands:" -ForegroundColor Cyan
Write-Host "   View logs: docker logs -f steem-bridge" -ForegroundColor White
Write-Host "   Stop container: docker stop steem-bridge" -ForegroundColor White
Write-Host "   Remove container: docker rm steem-bridge" -ForegroundColor White

Write-Host ""
Write-Host "Deployment complete!" -ForegroundColor Green