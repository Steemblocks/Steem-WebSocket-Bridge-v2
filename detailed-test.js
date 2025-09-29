const WebSocket = require('ws');

console.log('Detailed API Response Time Analysis\n');

async function testSingleAPI(method, params, description) {
  return new Promise((resolve) => {
    const ws = new WebSocket('ws://localhost:8080');
    const startTime = Date.now();
    let responded = false;
    
    const timeout = setTimeout(() => {
      if (!responded) {
        console.log(`❌ ${description}: TIMEOUT (>5s)`);
        ws.close();
        resolve({ method, time: null, success: false, cached: false });
      }
    }, 5000);
    
    ws.on('open', () => {
      ws.send(JSON.stringify({
        id: 1,
        method: `condenser_api.${method}`,
        params: params
      }));
    });
    
    ws.on('message', (data) => {
      const message = JSON.parse(data);
      
      if (message.type === 'response' && !responded) {
        responded = true;
        clearTimeout(timeout);
        
        const responseTime = Date.now() - startTime;
        const success = !!message.result;
        const dataSize = JSON.stringify(message.result || {}).length;
        
        console.log(`${success ? '✅' : '❌'} ${description}: ${responseTime}ms (${(dataSize/1024).toFixed(1)}KB)`);
        
        ws.close();
        resolve({ 
          method, 
          time: responseTime, 
          success, 
          dataSize,
          cached: responseTime < 50 // Likely cached if very fast
        });
      }
    });
    
    ws.on('error', () => {
      if (!responded) {
        responded = true;
        clearTimeout(timeout);
        console.log(`❌ ${description}: CONNECTION ERROR`);
        resolve({ method, time: null, success: false, cached: false });
      }
    });
  });
}

async function runDetailedTests() {
  const tests = [
    ['get_dynamic_global_properties', [], 'Global Properties (CACHED)'],
    ['get_dynamic_global_properties', [], 'Global Properties (2nd call)'],
    ['get_active_witnesses', [], 'Active Witnesses (CACHED)'], 
    ['get_active_witnesses', [], 'Active Witnesses (2nd call)'],
    ['get_block_header', [99500000], 'Block Header (Recent)'],
    ['get_block_header', [75000000], 'Block Header (Old)'],
    ['get_block', [99500000], 'Full Block (Recent)'],
    ['get_block', [75000000], 'Full Block (Old)'],
    ['get_ops_in_block', [99500000, false], 'Operations (Recent)'],
    ['get_ops_in_block', [75000000, false], 'Operations (Old)'],
  ];
  
  const results = [];
  
  for (const [method, params, description] of tests) {
    const result = await testSingleAPI(method, params, description);
    results.push(result);
    await new Promise(resolve => setTimeout(resolve, 500)); // 500ms delay between tests
  }
  
  // Analysis
  console.log('\n' + '='.repeat(70));
  console.log('DETAILED PERFORMANCE ANALYSIS');
  console.log('='.repeat(70));
  
  const cached = results.filter(r => r.cached && r.success);
  const uncached = results.filter(r => !r.cached && r.success);
  const failed = results.filter(r => !r.success);
  
  if (cached.length > 0) {
    const avgCached = cached.reduce((sum, r) => sum + r.time, 0) / cached.length;
    console.log(`🟢 CACHED responses: ${Math.round(avgCached)}ms average (${cached.length} tests)`);
  }
  
  if (uncached.length > 0) {
    const avgUncached = uncached.reduce((sum, r) => sum + r.time, 0) / uncached.length;
    console.log(`🔵 UNCACHED responses: ${Math.round(avgUncached)}ms average (${uncached.length} tests)`);
  }
  
  if (failed.length > 0) {
    console.log(`🔴 FAILED responses: ${failed.length} tests failed`);
  }
  
  const successful = results.filter(r => r.success && r.time);
  if (successful.length > 0) {
    const fastest = Math.min(...successful.map(r => r.time));
    const slowest = Math.max(...successful.map(r => r.time));
    const average = successful.reduce((sum, r) => sum + r.time, 0) / successful.length;
    
    console.log(`\n Fastest: ${fastest}ms`);
    console.log(` Slowest: ${slowest}ms`);
    console.log(` Average: ${Math.round(average)}ms`);
    console.log(` Success Rate: ${Math.round(successful.length/results.length*100)}%`);
  }
}

runDetailedTests().then(() => {
  console.log('\nnode Test completed!');
  process.exit(0);
});