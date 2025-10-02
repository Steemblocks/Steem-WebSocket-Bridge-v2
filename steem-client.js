const WebSocket = require('ws');

// Steem WebSocket Client - Connect to Steem blockchain via WebSocket API
// This client can be used to interact with the Steem WebSocket Bridge
// and receive real-time blockchain updates
class SteemClient {
  constructor(url = 'ws://localhost:8080') {
    this.url = url;
    this.ws = null;
    this.messageId = 1;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);

      this.ws.on('open', () => {
        console.log('Connected to Steem WebSocket API');
        resolve();
      });

      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data);
          this.handleMessage(message);
        } catch (error) {
          console.error('Error parsing message:', error.message);
        }
      });

      this.ws.on('close', () => {
        console.log('Connection closed');
      });

      this.ws.on('error', (error) => {
        console.error('Connection error:', error.message);
        reject(error);
      });
    });
  }

  handleMessage(message) {
    switch (message.type) {
      case 'connection':
        console.log('Connection established:', message.message);
        console.log('Available APIs:', message.availableApis);
        break;
        
      case 'response':
        console.log(`Response ${message.id}:`);
        if (message.result) {
          if (typeof message.result === 'object') {
            console.log(JSON.stringify(message.result, null, 2));
          } else {
            console.log(message.result);
          }
        }
        break;
        
      case 'error':
        console.error(`Error ${message.id}:`, message.error);
        break;
        
      case 'broadcast':
        console.log(`Broadcast - ${message.method}:`);
        if (message.data && message.data.head_block_number) {
          console.log(`   Current block: ${message.data.head_block_number}`);
          console.log(`   Irreversible: ${message.data.last_irreversible_block_num}`);
        }
        break;
        
      default:
        console.log('Received:', message);
    }
  }

  sendRequest(method, params = []) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('WebSocket is not connected');
      return;
    }

    const request = {
      id: this.messageId++,
      method,
      params
    };

    console.log(`Sending request: ${method}`);
    this.ws.send(JSON.stringify(request));
  }

  close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

// Test function - demonstrates client usage
async function runTests() {
  const client = new SteemClient();
  
  try {
    await client.connect();
    
    // Wait a moment for connection to stabilize
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('\nStarting Steem API tests...\n');
    
    // Test 1: Get dynamic global properties (CRITICAL API)
    console.log('=== Test 1: get_dynamic_global_properties ===');
    client.sendRequest('condenser_api.get_dynamic_global_properties');
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Test 2: Get block header
    console.log('\n=== Test 2: get_block_header ===');
    client.sendRequest('condenser_api.get_block_header', [75000000]);
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Test 3: Get block
    console.log('\n=== Test 3: get_block ===');
    client.sendRequest('condenser_api.get_block', [75000000]);
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Test 4: Get operations in block
    console.log('\n=== Test 4: get_ops_in_block ===');
    client.sendRequest('condenser_api.get_ops_in_block', [75000000, false]);
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Test 5: Get active witnesses
    console.log('\n=== Test 5: get_active_witnesses ===');
    client.sendRequest('condenser_api.get_active_witnesses');
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    console.log('\nTests completed. WebSocket will continue receiving broadcasts...');
    console.log('Press Ctrl+C to exit.');
    
    // Keep connection alive to receive real-time blockchain updates
    // In production, client would stay connected for live data
    
  } catch (error) {
    console.error('Test failed:', error.message);
    client.close();
  }
}

// Run demonstration if this file is executed directly
if (require.main === module) {
  console.log('Steem WebSocket Client');
  console.log('Connecting to Steem blockchain via WebSocket...\n');
  runTests();
}

module.exports = SteemClient;
