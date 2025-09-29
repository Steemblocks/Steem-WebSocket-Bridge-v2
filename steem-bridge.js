const WebSocket = require('ws');
const { Client } = require('dsteem');
const http = require('http');

// Initialize Steem client with multiple nodes for redundancy
const steemNodes = [
  'https://api.steemit.com',
  'https://api.moecki.online',
  'https://api.steemitdev.com',
  'https://steemd.steemworld.org',
  'https://rpc.amarbangla.net'
];

class SteemWebSocketServer {
  constructor(port = 8080) {
    this.port = port;
    this.steemClient = new Client(steemNodes[0], { failoverThreshold: 0 });
    this.currentNodeIndex = 0;
    this.wss = null;
    this.httpServer = null;
    this.startTime = Date.now();
    
    // Enhanced node management with health tracking
    this.nodeHealth = steemNodes.map(node => ({
      url: node,
      healthy: true,
      lastError: null,
      errorCount: 0,
      lastSuccess: Date.now(),
      avgResponseTime: 0,
      totalRequests: 0
    }));
    
    // Smart cache system with multiple layers
    this.cache = {
      globalProperties: null,
      activeWitnesses: null,
      blockHeaders: new Map(), // Cache block headers
      blocks: new Map(),       // Cache full blocks  
      operations: new Map(),   // Cache operations
      lastGlobalUpdate: 0,
      lastWitnessUpdate: 0,
      globalTTL: 3000,    // 3 seconds
      witnessTTL: 60000,  // 60 seconds
      blockTTL: 300000,   // 5 minutes for blocks
      maxCacheSize: 1000  // Max cached items per type
    };
    
    // Request queue to handle burst traffic
    this.requestQueue = [];
    this.isProcessingQueue = false;
    this.maxQueueSize = 1000;
    
    // Error tracking and recovery
    this.errorStats = {
      totalErrors: 0,
      nodeErrors: 0,
      cacheHits: 0,
      cacheMisses: 0,
      autoRecoveries: 0
    };
    
    this.initializeServer();
    this.setupPeriodicUpdates();
    this.startNodeHealthMonitoring();
  }

  initializeServer() {
    // Create HTTP server first
    this.httpServer = http.createServer((req, res) => {
      // Enable CORS for dhakawitness.com
      const origin = req.headers.origin;
      const allowedOrigins = [
        'https://dhakawitness.com',
        'https://www.dhakawitness.com',
        'http://localhost:3000', // For development
        'http://localhost:8080'  // For local testing
      ];
      
      if (allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
      }
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'DNT,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Range');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Length,Content-Range');
      
      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }
      
      // Health check endpoint
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          status: 'healthy',
          timestamp: new Date().toISOString()
        }));
        return;
      }
      
      // Status endpoint
      if (req.url === '/status') {
        const stats = this.getStats();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(stats));
        return;
      }
      
      // Default response for other HTTP requests
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        service: 'Steem WebSocket Bridge',
        version: 'v2.0.0',
        domain: 'dhakawitness.com',
        websocket: `wss://dhakawitness.com`,
        websocket_local: `ws://localhost:${this.port}`,
        endpoints: {
          health: '/health',
          status: '/status'
        },
      }));
    });

    // Create WebSocket server using the HTTP server
    this.wss = new WebSocket.Server({ 
      server: this.httpServer,
      maxPayload: 16 * 1024, // 16KB max message size
      perMessageDeflate: true // Enable compression
    });
    
    console.log(`Steem WebSocket API server starting on port ${this.port}`);
    
    this.wss.on('connection', (ws, request) => {
      const clientIP = request.socket.remoteAddress;
      
      // Connection limiting - max 100 connections
      if (this.wss.clients.size > 100) {
        console.log(`Connection limit reached, rejecting ${clientIP}`);
        ws.close(1008, 'Server at capacity');
        return;
      }
      
      console.log(`New client connected from ${clientIP} (${this.wss.clients.size} total)`);
      
      // Rate limiting per connection
      ws.messageCount = 0;
      ws.lastReset = Date.now();
      ws.maxMessagesPerMinute = 60;
      
      // Send welcome message
      ws.send(JSON.stringify({
        type: 'connection',
        status: 'connected',
        message: 'Connected to Steem WebSocket API',
        availableApis: [
          'get_dynamic_global_properties',
          'get_block_header',
          'get_block',
          'get_ops_in_block',
          'get_active_witnesses',
          'get_transaction'
        ]
      }));

      ws.on('message', async (message) => {
        // Rate limiting check
        const now = Date.now();
        if (now - ws.lastReset > 60000) { // Reset every minute
          ws.messageCount = 0;
          ws.lastReset = now;
        }
        
        ws.messageCount++;
        if (ws.messageCount > ws.maxMessagesPerMinute) {
          ws.send(JSON.stringify({
            type: 'error',
            error: 'Rate limit exceeded. Max 60 messages per minute.',
            rateLimitReset: new Date(ws.lastReset + 60000).toISOString()
          }));
          return;
        }
        
        try {
          const data = JSON.parse(message);
          
          // Queue the request if we're busy
          if (this.requestQueue.length < this.maxQueueSize) {
            this.requestQueue.push({ ws, data });
            this.processQueue();
          } else {
            ws.send(JSON.stringify({
              type: 'error',
              error: 'Server queue full. Please retry in a moment.'
            }));
          }
        } catch (error) {
          console.error('Error parsing message:', error.message);
          ws.send(JSON.stringify({
            type: 'error',
            error: 'Invalid JSON format',
            message: error.message
          }));
        }
      });

      ws.on('close', () => {
        console.log(`Client disconnected from ${clientIP} (${this.wss.clients.size} remaining)`);
        // Cleanup any pending requests for this client
        this.requestQueue = this.requestQueue.filter(req => req.ws !== ws);
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error.message);
      });
    });

    this.wss.on('listening', () => {
      console.log(`WebSocket server listening on ws://localhost:${this.port}`);
      console.log(`Health check available at http://localhost:${this.port}/health`);
      console.log(`Status endpoint available at http://localhost:${this.port}/status`);
      console.log(`Production domain: https://dhakawitness.com`);
      console.log(`Production WebSocket: wss://dhakawitness.com`);
      console.log(`Available API endpoints:`);
      console.log('   - condenser_api.get_dynamic_global_properties (CRITICAL)');
      console.log('   - condenser_api.get_block_header');
      console.log('   - condenser_api.get_block');
      console.log('   - condenser_api.get_ops_in_block');
      console.log('   - condenser_api.get_active_witnesses');
      console.log('   - condenser_api.get_transaction');
    });

    this.wss.on('error', (error) => {
      console.error('WebSocket server error:', error.message);
    });

    // Start the HTTP server
    this.httpServer.listen(this.port, () => {
      console.log(`HTTP/WebSocket server listening on port ${this.port}`);
    });
  }

  // Process request queue to handle burst traffic
  async processQueue() {
    if (this.isProcessingQueue || this.requestQueue.length === 0) {
      return;
    }
    
    this.isProcessingQueue = true;
    
    while (this.requestQueue.length > 0) {
      const { ws, data } = this.requestQueue.shift();
      
      // Check if client is still connected
      if (ws.readyState === WebSocket.OPEN) {
        try {
          await this.handleMessage(ws, data);
        } catch (error) {
          console.error('Queue processing error:', error.message);
        }
      }
      
      // Small delay to prevent overwhelming the system
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    this.isProcessingQueue = false;
  }

  // Intelligent node switching with health tracking
  async switchToHealthyNode() {
    const currentHealth = this.nodeHealth[this.currentNodeIndex];
    currentHealth.healthy = false;
    currentHealth.lastError = Date.now();
    currentHealth.errorCount++;
    
    console.log(`🔄 Node ${steemNodes[this.currentNodeIndex]} marked unhealthy (${currentHealth.errorCount} errors)`);
    
    // Find the healthiest node
    const healthyNodes = this.nodeHealth
      .map((health, index) => ({ ...health, index }))
      .filter(node => node.healthy || (Date.now() - node.lastError) > 60000) // Recovery after 1 minute
      .sort((a, b) => {
        // Sort by: healthy status, low error count, low response time
        if (a.healthy !== b.healthy) return b.healthy - a.healthy;
        if (a.errorCount !== b.errorCount) return a.errorCount - b.errorCount;
        return a.avgResponseTime - b.avgResponseTime;
      });
    
    if (healthyNodes.length === 0) {
      console.warn('All nodes unhealthy, using current node');
      return;
    }
    
    const bestNode = healthyNodes[0];
    this.currentNodeIndex = bestNode.index;
    
    console.log(`Switched to healthier node: ${steemNodes[this.currentNodeIndex]} (errors: ${bestNode.errorCount}, avg: ${bestNode.avgResponseTime}ms)`);
    
    this.steemClient = new Client(steemNodes[this.currentNodeIndex], { 
      failoverThreshold: 0,
      timeout: 10000 
    });
    
    // Clear caches to ensure fresh data from new node
    this.clearCache();
    this.errorStats.autoRecoveries++;
  }

  // Smart API call with retry logic and performance tracking
  async callSteemAPI(method, params, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const startTime = Date.now();
      const nodeHealth = this.nodeHealth[this.currentNodeIndex];
      
      try {
        let result;
        
        // Route to appropriate method
        switch (method) {
          case 'getDynamicGlobalProperties':
            result = await this.steemClient.database.getDynamicGlobalProperties();
            break;
          case 'getBlockHeader':
            result = await this.steemClient.database.getBlockHeader(params[0]);
            break;
          case 'getBlock':
            result = await this.steemClient.database.getBlock(params[0]);
            break;
          case 'getOpsInBlock':
            result = await this.steemClient.call('condenser_api', 'get_ops_in_block', params);
            break;
          case 'getActiveWitnesses':
            result = await this.steemClient.database.call('get_active_witnesses', []);
            break;
          case 'getTransaction':
            result = await this.steemClient.database.getTransaction(params[0]);
            break;
          default:
            throw new Error(`Unknown method: ${method}`);
        }
        
        // Update node health on success
        const responseTime = Date.now() - startTime;
        nodeHealth.lastSuccess = Date.now();
        nodeHealth.totalRequests++;
        nodeHealth.avgResponseTime = Math.round(
          (nodeHealth.avgResponseTime * (nodeHealth.totalRequests - 1) + responseTime) / nodeHealth.totalRequests
        );
        nodeHealth.healthy = true;
        
        return result;
        
      } catch (error) {
        const responseTime = Date.now() - startTime;
        nodeHealth.errorCount++;
        nodeHealth.lastError = Date.now();
        
        console.error(`❌ API call failed (attempt ${attempt}/${maxRetries}): ${error.message} (${responseTime}ms)`);
        
        // Try switching nodes if this isn't the last attempt
        if (attempt < maxRetries) {
          await this.switchToHealthyNode();
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // Exponential backoff
        } else {
          this.errorStats.totalErrors++;
          this.errorStats.nodeErrors++;
          throw error;
        }
      }
    }
  }

  // Node health monitoring
  startNodeHealthMonitoring() {
    setInterval(async () => {
      // Test current node health
      try {
        const startTime = Date.now();
        await this.steemClient.database.getDynamicGlobalProperties();
        const responseTime = Date.now() - startTime;
        
        const nodeHealth = this.nodeHealth[this.currentNodeIndex];
        nodeHealth.lastSuccess = Date.now();
        nodeHealth.healthy = true;
        
        // Consider node slow if consistently over 2 seconds
        if (responseTime > 2000) {
          nodeHealth.avgResponseTime = Math.max(nodeHealth.avgResponseTime, responseTime);
          console.warn(`Node ${steemNodes[this.currentNodeIndex]} responding slowly: ${responseTime}ms`);
        }
        
      } catch (error) {
        console.warn(`Health check failed for ${steemNodes[this.currentNodeIndex]}: ${error.message}`);
        await this.switchToHealthyNode();
      }
    }, 30000); // Health check every 30 seconds
    
    console.log('Node health monitoring started (30s intervals)');
  }

  // Enhanced cache management
  clearCache() {
    this.cache.globalProperties = null;
    this.cache.activeWitnesses = null;
    this.cache.blockHeaders.clear();
    this.cache.blocks.clear();
    this.cache.operations.clear();
    this.cache.lastGlobalUpdate = 0;
    this.cache.lastWitnessUpdate = 0;
    console.log('Cache cleared for node switch');
  }

  // Smart cache with size management
  setCacheItem(map, key, value) {
    if (map.size >= this.cache.maxCacheSize) {
      // Remove oldest items (LRU-style)
      const oldestKey = map.keys().next().value;
      map.delete(oldestKey);
    }
    map.set(key, { value, timestamp: Date.now() });
  }

  getCacheItem(map, key, ttl) {
    const item = map.get(key);
    if (!item) {
      this.errorStats.cacheMisses++;
      return null;
    }
    
    if (Date.now() - item.timestamp > ttl) {
      map.delete(key);
      this.errorStats.cacheMisses++;
      return null;
    }
    
    this.errorStats.cacheHits++;
    return item.value;
  }

  async handleMessage(ws, data) {
    const { id, method, params = [] } = data;
    
    if (!method) {
      ws.send(JSON.stringify({
        id,
        error: 'Method is required',
        type: 'error'
      }));
      return;
    }

    console.log(`Received request: ${method} with params:`, params);

    try {
      let result;
      
      switch (method) {
        case 'condenser_api.get_dynamic_global_properties':
        case 'get_dynamic_global_properties':
          result = await this.getDynamicGlobalProperties();
          break;
          
        case 'condenser_api.get_block_header':
        case 'get_block_header':
          if (!params[0]) {
            throw new Error('Block number is required');
          }
          result = await this.getBlockHeader(params[0]);
          break;
          
        case 'condenser_api.get_block':
        case 'get_block':
          if (!params[0]) {
            throw new Error('Block number is required');
          }
          result = await this.getBlock(params[0]);
          break;
          
        case 'condenser_api.get_ops_in_block':
        case 'get_ops_in_block':
          if (!params[0]) {
            throw new Error('Block number is required');
          }
          result = await this.getOpsInBlock(params[0], params[1] || false);
          break;
          
        case 'condenser_api.get_active_witnesses':
        case 'get_active_witnesses':
          result = await this.getActiveWitnesses();
          break;
          
        case 'condenser_api.get_transaction':
        case 'get_transaction':
          if (!params[0]) {
            throw new Error('Transaction ID is required');
          }
          result = await this.getTransaction(params[0]);
          break;
          
        default:
          throw new Error(`Unsupported method: ${method}`);
      }

      ws.send(JSON.stringify({
        id,
        result,
        type: 'response'
      }));

      console.log(`Response sent for ${method}`);
      
    } catch (error) {
      const errorMessage = error?.message || error?.toString() || 'Unknown error occurred';
      const errorId = id || 'unknown';
      const errorMethod = method || 'unknown_method';
      
      console.error(`Error handling ${errorMethod} (ID: ${errorId}):`, errorMessage);
      
      // Try to switch to backup node if current node fails
      if (errorMessage.includes('network') || errorMessage.includes('timeout')) {
        await this.switchNode();
      }
      
      ws.send(JSON.stringify({
        id: errorId,
        error: errorMessage,
        type: 'error',
        method: errorMethod
      }));
    }
  }

  // CRITICAL HIGH-FREQUENCY API with enhanced caching and error handling
  async getDynamicGlobalProperties() {
    const now = Date.now();
    
    // Return cached result if still valid
    if (this.cache.globalProperties && (now - this.cache.lastGlobalUpdate) < this.cache.globalTTL) {
      this.errorStats.cacheHits++;
      return this.cache.globalProperties;
    }

    try {
      const result = await this.callSteemAPI('getDynamicGlobalProperties', []);
      
      // Cache the result with timestamp
      this.cache.globalProperties = result;
      this.cache.lastGlobalUpdate = now;
      this.errorStats.cacheMisses++;
      
      console.log(`Global properties updated - Block: ${result.head_block_number} (${steemNodes[this.currentNodeIndex]})`);
      return result;
      
    } catch (error) {
      // Return stale cache if available during errors
      if (this.cache.globalProperties) {
        console.warn('⚠️ Using stale global properties cache due to API error');
        this.errorStats.cacheHits++;
        return this.cache.globalProperties;
      }
      throw error;
    }
  }

  async getBlockHeader(blockNumber) {
    try {
      // Check cache first
      const cacheKey = `header_${blockNumber}`;
      const cached = this.getCacheItem(this.cache.blockHeaders, cacheKey, this.cache.blockTTL);
      if (cached) return cached;
      
      const result = await this.callSteemAPI('getBlockHeader', [blockNumber]);
      
      // Cache the result
      this.setCacheItem(this.cache.blockHeaders, cacheKey, result);
      
      console.log(`Block header retrieved: ${blockNumber} (${steemNodes[this.currentNodeIndex]})`);
      return result;
    } catch (error) {
      console.error(`❌ Failed to get block header ${blockNumber}:`, error.message);
      throw error;
    }
  }

  async getBlock(blockNumber) {
    try {
      // Check cache first
      const cacheKey = `block_${blockNumber}`;
      const cached = this.getCacheItem(this.cache.blocks, cacheKey, this.cache.blockTTL);
      if (cached) return cached;
      
      const result = await this.callSteemAPI('getBlock', [blockNumber]);
      
      // Cache the result
      this.setCacheItem(this.cache.blocks, cacheKey, result);
      
      console.log(`Block retrieved: ${blockNumber} with ${result.transactions?.length || 0} transactions (${steemNodes[this.currentNodeIndex]})`);
      return result;
    } catch (error) {
      console.error(`❌ Failed to get block ${blockNumber}:`, error.message);
      throw error;
    }
  }

  async getOpsInBlock(blockNumber, onlyVirtual = false) {
    try {
      // Check cache first
      const cacheKey = `ops_${blockNumber}_${onlyVirtual}`;
      const cached = this.getCacheItem(this.cache.operations, cacheKey, this.cache.blockTTL);
      if (cached) return cached;
      
      const result = await this.callSteemAPI('getOpsInBlock', [blockNumber, onlyVirtual]);
      
      // Cache the result
      this.setCacheItem(this.cache.operations, cacheKey, result);
      
      console.log(`Operations retrieved for block ${blockNumber}: ${result.length} ops (virtual: ${onlyVirtual}) (${steemNodes[this.currentNodeIndex]})`);
      return result;
    } catch (error) {
      console.error(`❌ Failed to get ops in block ${blockNumber}:`, error.message);
      throw error;
    }
  }

  async getActiveWitnesses() {
    const now = Date.now();
    
    // Return cached result if still valid
    if (this.cache.activeWitnesses && (now - this.cache.lastWitnessUpdate) < this.cache.witnessTTL) {
      this.errorStats.cacheHits++;
      return this.cache.activeWitnesses;
    }

    try {
      const result = await this.callSteemAPI('getActiveWitnesses', []);
      
      // Cache the result
      this.cache.activeWitnesses = result;
      this.cache.lastWitnessUpdate = now;
      this.errorStats.cacheMisses++;
      
      console.log(`Active witnesses retrieved: ${result.length} witnesses (${steemNodes[this.currentNodeIndex]})`);
      return result;
      
    } catch (error) {
      // Return stale cache if available during errors
      if (this.cache.activeWitnesses) {
        console.warn('Using stale witnesses cache due to API error');
        this.errorStats.cacheHits++;
        return this.cache.activeWitnesses;
      }
      throw error;
    }
  }

  async getTransaction(transactionId) {
    try {
      const result = await this.callSteemAPI('getTransaction', [transactionId]);
      console.log(`Transaction retrieved: ${transactionId} (${steemNodes[this.currentNodeIndex]})`);
      return result;
    } catch (error) {
      console.error(`❌ Failed to get transaction ${transactionId}:`, error.message);
      throw error;
    }
  }

  // Setup periodic updates for critical data
  setupPeriodicUpdates() {
    // Update global properties every 3 seconds (matches client requirements)
    setInterval(async () => {
      try {
        const previousBlock = this.cache.globalProperties?.head_block_number;
        await this.getDynamicGlobalProperties();
        
        // Only broadcast if data actually changed
        const currentBlock = this.cache.globalProperties?.head_block_number;
        if (this.wss && this.cache.globalProperties && currentBlock !== previousBlock) {
          const message = JSON.stringify({
            type: 'broadcast',
            method: 'dynamic_global_properties_update',
            data: this.cache.globalProperties,
            timestamp: new Date().toISOString()
          });
          
          let broadcastCount = 0;
          this.wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(message);
              broadcastCount++;
            }
          });
          
          if (broadcastCount > 0) {
            console.log(`Broadcasted block ${currentBlock} to ${broadcastCount} clients`);
          }
        }
      } catch (error) {
        console.error('Periodic update failed:', error.message);
        // Try switching nodes if we get repeated failures
        await this.switchNode();
      }
    }, 3000);

    console.log('Smart periodic updates initialized (3s intervals)');
  }

  // Node failover functionality
  async switchNode() {
    this.currentNodeIndex = (this.currentNodeIndex + 1) % steemNodes.length;
    const newNode = steemNodes[this.currentNodeIndex];
    
    console.log(`Switching to backup node: ${newNode}`);
    
    this.steemClient = new Client(newNode, { failoverThreshold: 0 });
    
    // Clear all caches to force fresh data from new node
    this.cache.globalProperties = null;
    this.cache.activeWitnesses = null;
    this.cache.lastGlobalUpdate = 0;
    this.cache.lastWitnessUpdate = 0;
  }

  // Broadcast message to all connected clients
  broadcast(message) {
    if (!this.wss) return;
    
    this.wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(message));
      }
    });
  }

  // Get server statistics
  getStats() {
    const uptime = Date.now() - this.startTime;
    return {
      service: 'Steem WebSocket API Bridge',
      version: '1.0.0',
      domain: 'dhakawitness.com',
      status: 'running',
      uptime: {
        milliseconds: uptime,
        seconds: Math.floor(uptime / 1000),
        minutes: Math.floor(uptime / (1000 * 60)),
        hours: Math.floor(uptime / (1000 * 60 * 60))
      },
      endpoints: {
        websocket_production: 'wss://dhakawitness.com',
        websocket_local: `ws://localhost:${this.port}`,
        health: '/health',
        status: '/status'
      },
      connectedClients: this.wss ? this.wss.clients.size : 0,
      queueLength: this.requestQueue.length,
      maxQueueSize: this.maxQueueSize,
      totalApiCallsSaved: Math.floor((uptime / 1000) * 13.2), // Estimated API calls saved
      steemNetwork: {
        currentNode: steemNodes[this.currentNodeIndex],
        nodeIndex: this.currentNodeIndex,
        availableNodes: steemNodes.length,
        lastBlockProcessed: this.cache.globalProperties ? this.cache.globalProperties.head_block_number : null
      },
      cache: {
        globalProperties: {
          cached: !!this.cache.globalProperties,
          lastUpdate: this.cache.lastGlobalUpdate ? new Date(this.cache.lastGlobalUpdate).toISOString() : null,
          ageMs: this.cache.lastGlobalUpdate ? Date.now() - this.cache.lastGlobalUpdate : null,
          ttlMs: this.cache.globalTTL
        },
        activeWitnesses: {
          cached: !!this.cache.activeWitnesses,
          lastUpdate: this.cache.lastWitnessUpdate ? new Date(this.cache.lastWitnessUpdate).toISOString() : null,
          ageMs: this.cache.lastWitnessUpdate ? Date.now() - this.cache.lastWitnessUpdate : null,
          ttlMs: this.cache.witnessTTL
        }
      }
    };
  }
}

// Start the server
const PORT = process.env.PORT || 8080;
const server = new SteemWebSocketServer(PORT);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n Shutting down Steem WebSocket API server...');
  
  if (server.wss) {
    server.wss.close(() => {
      console.log('WebSocket server closed');
      if (server.httpServer) {
        server.httpServer.close(() => {
          console.log('HTTP server closed successfully');
          process.exit(0);
        });
      } else {
        process.exit(0);
      }
    });
  } else {
    process.exit(0);
  }
});

process.on('SIGTERM', () => {
  console.log('\n Received SIGTERM, shutting down gracefully...');
  
  if (server.wss) {
    server.wss.close(() => {
      console.log('WebSocket server closed');
      if (server.httpServer) {
        server.httpServer.close(() => {
          console.log('HTTP server closed successfully');
          process.exit(0);
        });
      } else {
        process.exit(0);
      }
    });
  } else {
    process.exit(0);
  }
});

// Export for testing
module.exports = SteemWebSocketServer;