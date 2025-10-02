const WebSocket = require('ws');

/**
 * High-Frequency Steem Client - Optimized for 24+ requests per second
 * 
 * This client demonstrates two approaches:
 * 1. Subscription-based (recommended for live data)
 * 2. High-frequency polling (with increased rate limits)
 */
class HighFrequencySteemClient {
  constructor(url = 'ws://localhost:8080') {
    this.url = url;
    this.ws = null;
    this.messageId = 1;
    this.subscriptions = new Set();
    this.lastBlockNumber = null;
    this.requestCount = 0;
    this.subscriptionCount = 0;
    this.startTime = Date.now();
    this.callbacks = new Map();
    this.subscribedTo = new Set();
    this.isConnected = false;
    this.heartbeatInterval = null;
    this.reconnectTimeout = null;
    this.reconnectDelay = 5000;
  }

  connect() {
    return new Promise((resolve, reject) => {
      console.log('Connecting to Steem Bridge:', this.url);
      
      this.ws = new WebSocket(this.url);
      
      this.ws.on('open', () => {
        console.log('Connected to Steem Bridge');
        this.isConnected = true;
        this.startHeartbeat();
        resolve();
      });
      
      this.ws.on('message', (data) => {
        this.handleMessage(data);
      });
      
      this.ws.on('error', (error) => {
        console.error('WebSocket error:', error.message);
        this.isConnected = false;
        if (!this.isConnected) {
          reject(error);
        }
      });
      
      this.ws.on('close', () => {
        console.log('Connection closed, attempting to reconnect...');
        this.isConnected = false;
        this.stopHeartbeat();
        this.scheduleReconnect();
      });
    });
  }

  handleMessage(message) {
    try {
      const data = JSON.parse(message);
      
      // Handle subscription updates
      if (data.type === 'subscription') {
        this.handleSubscriptionUpdate(data);
        return;
      }
      
      // Handle broadcasts
      if (data.type === 'broadcast') {
        this.handleBroadcast(data);
        return;
      }
      
      // Handle regular API responses
      if (data.id && this.callbacks.has(data.id)) {
        const callback = this.callbacks.get(data.id);
        this.callbacks.delete(data.id);
        
        if (data.error) {
          callback.reject(new Error(data.error.message || 'API Error'));
        } else {
          callback.resolve(data.result);
        }
      }
    } catch (error) {
      console.error('Failed to parse message:', error.message);
    }
  }

  handleSubscriptionUpdate(message) {
    this.subscriptionCount++;
    
    switch (message.subscription) {
      case 'global_properties':
        console.log('Global Properties Update:', {
          head_block_number: message.data.head_block_number,
          total_vesting_fund_steem: message.data.total_vesting_fund_steem,
          timestamp: new Date().toISOString()
        });
        break;
        
      case 'block_headers':
        console.log('New Block Header:', {
          block_id: message.data.block_id,
          previous: message.data.previous,
          timestamp: message.data.timestamp,
          witness: message.data.witness
        });
        break;
        
      case 'operations':
        console.log('Operations Update:', {
          count: message.data.length,
          types: [...new Set(message.data.map(op => op[0]))],
          timestamp: new Date().toISOString()
        });
        break;
        
      case 'witnesses':
        console.log('Witnesses Update:', {
          count: message.data.length,
          timestamp: new Date().toISOString()
        });
        break;
        
      case 'blocks':
        console.log('Full Block Update:', {
          block_num: message.data.block_num || 'unknown',
          transaction_count: message.data.transactions?.length || 0,
          timestamp: new Date().toISOString()
        });
        break;
        
      default:
        console.log('Unknown subscription update:', message.subscription);
    }
  }

  handleBroadcast(message) {
    console.log('Broadcast received:', message.event, message.data);
  }

  sendRequest(method, params = []) {
    return new Promise((resolve, reject) => {
      if (!this.isConnected) {
        reject(new Error('Not connected to WebSocket'));
        return;
      }
      
      const id = this.messageId++;
      this.callbacks.set(id, { resolve, reject });
      
      const message = {
        id,
        jsonrpc: '2.0',
        method,
        params
      };
      
      this.ws.send(JSON.stringify(message));
      this.requestCount++;
    });
  }

  // Subscription methods
  subscribeToGlobalProperties() {
    this.subscribedTo.add('global_properties');
    return this.sendRequest('subscribe', ['global_properties']);
  }

  subscribeToBlocks() {
    this.subscribedTo.add('blocks');
    return this.sendRequest('subscribe', ['blocks']);
  }

  subscribeToBlockHeaders() {
    this.subscribedTo.add('block_headers');
    return this.sendRequest('subscribe', ['block_headers']);
  }

  subscribeToOperations() {
    this.subscribedTo.add('operations');
    return this.sendRequest('subscribe', ['operations']);
  }

  subscribeToWitnesses() {
    this.subscribedTo.add('witnesses');
    return this.sendRequest('subscribe', ['witnesses']);
  }

  unsubscribeFromGlobalProperties() {
    this.subscribedTo.delete('global_properties');
    return this.sendRequest('unsubscribe', ['global_properties']);
  }

  unsubscribeFromBlocks() {
    this.subscribedTo.delete('blocks');
    return this.sendRequest('unsubscribe', ['blocks']);
  }

  unsubscribeFromBlockHeaders() {
    this.subscribedTo.delete('block_headers');
    return this.sendRequest('unsubscribe', ['block_headers']);
  }

  unsubscribeFromOperations() {
    this.subscribedTo.delete('operations');
    return this.sendRequest('unsubscribe', ['operations']);
  }

  unsubscribeFromWitnesses() {
    this.subscribedTo.delete('witnesses');
    return this.sendRequest('unsubscribe', ['witnesses']);
  }

  // High-frequency polling methods
  async startPolling(intervalMs = 1000) {
    console.log('Starting high-frequency polling at', 1000/intervalMs, 'requests per second');
    
    this.pollingInterval = setInterval(async () => {
      try {
        await this.sendRequest('get_dynamic_global_properties');
      } catch (error) {
        console.error('Polling request failed:', error.message);
      }
    }, intervalMs);
  }

  stopPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
      console.log('Stopped polling');
    }
  }

  startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      if (this.isConnected) {
        this.ws.ping();
      }
    }, 30000);
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    
    this.reconnectTimeout = setTimeout(() => {
      this.connect().catch(error => {
        console.error('Reconnection failed:', error.message);
        this.scheduleReconnect();
      });
    }, this.reconnectDelay);
  }

  getStats() {
    const runtime = (Date.now() - this.startTime) / 1000;
    return {
      runtime: runtime.toFixed(1) + 's',
      total_requests: this.requestCount,
      subscription_updates: this.subscriptionCount,
      requests_per_second: (this.requestCount / runtime).toFixed(2),
      updates_per_second: (this.subscriptionCount / runtime).toFixed(2),
      active_subscriptions: Array.from(this.subscribedTo),
      connected: this.isConnected
    };
  }

  close() {
    this.stopPolling();
    this.stopHeartbeat();
    
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    
    if (this.ws) {
      this.ws.close();
    }
    
    console.log('Client closed');
  }
}

// Demo function for high-frequency usage
async function runHighFrequencyDemo() {
  const client = new HighFrequencySteemClient('ws://localhost:8080');
  
  try {
    // Connect to the bridge
    await client.connect();
    
    console.log('\n1. Testing subscription system (recommended for high-frequency)...');
    
    // Subscribe to lightweight real-time data
    await client.subscribeToGlobalProperties();
    console.log('Subscribed to global properties updates');
    
    await client.subscribeToBlockHeaders();
    console.log('Subscribed to block header updates');
    
    // Wait for some subscription updates
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    console.log('\n2. Testing high-frequency polling (for comparison)...');
    
    // Test high-frequency polling at 24 req/s
    const pollingPromises = [];
    for (let i = 0; i < 10; i++) {
      pollingPromises.push(
        client.sendRequest('get_dynamic_global_properties')
          .then(() => console.log('Request', i + 1, 'completed'))
          .catch(error => console.error('Request', i + 1, 'failed:', error.message))
      );
      
      // Wait ~42ms between requests for ~24 req/s
      if (i < 9) {
        await new Promise(resolve => setTimeout(resolve, 42));
      }
    }
    
    await Promise.all(pollingPromises);
    
    console.log('\n3. Demonstrating sustained high-frequency load...');
    
    // Run 24 req/s for 3 seconds (72 requests total)
    const sustainedInterval = setInterval(async () => {
      try {
        await client.sendRequest('get_dynamic_global_properties');
      } catch (error) {
        console.error('Sustained request failed:', error.message);
      }
    }, 42); // ~24 req/s
    
    // Run polling test for 3 seconds
    await new Promise(resolve => setTimeout(resolve, 3000));
    clearInterval(sustainedInterval);
    
    console.log('\nFinal stats:', client.getStats());
    
    console.log('\nDemo completed successfully!');
    console.log('\nRECOMMENDATIONS FOR YOUR HIGH-FREQUENCY APP:');
    console.log('   Use subscriptions for: global_properties, block_headers, operations');
    console.log('   Subscriptions bypass ALL rate limits');
    console.log('   Get real-time updates only when data changes');
    console.log('   Much more efficient than 24 req/s polling');
    console.log('   WARNING: Use full block subscription carefully (large data)');
    console.log('   WARNING: Keep direct API calls for one-time queries only');
    
    // Keep light subscriptions active for live monitoring
    console.log('\nKeeping light subscriptions active for live monitoring...');
    console.log('Press Ctrl+C to exit.');
    
  } catch (error) {
    console.error('Demo failed:', error.message);
    client.close();
  }
}

// Usage examples
if (require.main === module) {
  console.log('High-Frequency Steem WebSocket Client');
  console.log('Optimized for 24+ requests per second\n');
  runHighFrequencyDemo();
}

module.exports = HighFrequencySteemClient;
