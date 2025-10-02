const WebSocket = require('ws');

console.log('COMPREHENSIVE API RESPONSE TIME ANALYSIS\n');

async function measureResponseTime(method, params, testName, expectedTime = 1000) {
  return new Promise((resolve) => {
    const ws = new WebSocket('ws://localhost:8080');
    const startTime = Date.now();
    let resolved = false;
    
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        console.log(`${testName}: TIMEOUT (>${expectedTime}ms)`);
        ws.close();
        resolve({ success: false, time: null, cached: false });
      }
    }, expectedTime);
    
    ws.on('open', () => {
      ws.send(JSON.stringify({
        id: 1,
        method: `condenser_api.${method}`,
        params: params
      }));
    });
    
    ws.on('message', (data) => {
      const message = JSON.parse(data);
      
      if (message.type === 'response' && !resolved) {
        resolved = true;
        clearTimeout(timeout);
        
        const responseTime = Date.now() - startTime;
        const success = !!message.result;
        const dataSize = message.result ? JSON.stringify(message.result).length : 0;
        const cached = responseTime < 50;
        
        const cacheStatus = cached ? 'CACHED' : 'FRESH';
        const sizeDisplay = dataSize > 0 ? `${(dataSize/1024).toFixed(1)}KB` : 'N/A';
        
        console.log(`${success ? 'SUCCESS' : 'FAILED'} ${testName.padEnd(40)} | ${String(responseTime + 'ms').padEnd(8)} | ${sizeDisplay.padEnd(8)} | ${cacheStatus}`);
        
        ws.close();
        resolve({ success, time: responseTime, cached, dataSize, testName });
      }
    });
    
    ws.on('error', () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        console.log(`${testName}: CONNECTION ERROR`);
        resolve({ success: false, time: null, cached: false, testName });
      }
    });
  });
}

async function runComprehensiveTest() {
  console.log('Method'.padEnd(42) + '| Time     | Size     | Cache Status');
  console.log('-'.repeat(75));
  
  const results = [];
  
  // Test critical cached APIs first
  results.push(await measureResponseTime('get_dynamic_global_properties', [], 'Global Properties (1st call)', 2000));
  await new Promise(r => setTimeout(r, 200));
  
  results.push(await measureResponseTime('get_dynamic_global_properties', [], 'Global Properties (2nd call - cached)', 2000));
  await new Promise(r => setTimeout(r, 200));
  
  results.push(await measureResponseTime('get_active_witnesses', [], 'Active Witnesses (1st call)', 2000));
  await new Promise(r => setTimeout(r, 200));
  
  results.push(await measureResponseTime('get_active_witnesses', [], 'Active Witnesses (2nd call - cached)', 2000));
  await new Promise(r => setTimeout(r, 500));
  
  // Test block-related APIs
  results.push(await measureResponseTime('get_block_header', [99500000], 'Block Header (Recent Block)', 2000));
  await new Promise(r => setTimeout(r, 200));
  
  results.push(await measureResponseTime('get_block_header', [75000000], 'Block Header (Old Block)', 2000));
  await new Promise(r => setTimeout(r, 200));
  
  results.push(await measureResponseTime('get_block', [99500000], 'Full Block (Recent)', 3000));
  await new Promise(r => setTimeout(r, 200));
  
  results.push(await measureResponseTime('get_block', [75000000], 'Full Block (Old)', 3000));
  await new Promise(r => setTimeout(r, 200));
  
  results.push(await measureResponseTime('get_ops_in_block', [99500000, false], 'Operations in Block (Recent)', 3000));
  await new Promise(r => setTimeout(r, 200));
  
  results.push(await measureResponseTime('get_ops_in_block', [75000000, false], 'Operations in Block (Old)', 3000));
  
  // Analysis
  console.log('\n' + '='.repeat(75));
  console.log('PERFORMANCE SUMMARY');
  console.log('='.repeat(75));
  
  const successful = results.filter(r => r.success);
  const cached = successful.filter(r => r.cached);
  const fresh = successful.filter(r => !r.cached);
  
  if (successful.length > 0) {
    const avgAll = successful.reduce((sum, r) => sum + r.time, 0) / successful.length;
    console.log(`Overall Average Response Time: ${Math.round(avgAll)}ms`);
  }
  
  if (cached.length > 0) {
    const avgCached = cached.reduce((sum, r) => sum + r.time, 0) / cached.length;
    console.log(`Cached API Average: ${Math.round(avgCached)}ms (${cached.length} calls)`);
  }
  
  if (fresh.length > 0) {
    const avgFresh = fresh.reduce((sum, r) => sum + r.time, 0) / fresh.length;
    console.log(`Fresh API Average: ${Math.round(avgFresh)}ms (${fresh.length} calls)`);
  }
  
  const failed = results.filter(r => !r.success);
  if (failed.length > 0) {
    console.log(`Failed APIs: ${failed.length}/${results.length}`);
  }
  
  console.log(`Success Rate: ${Math.round(successful.length/results.length*100)}%`);
  
  // Performance Grade
  if (successful.length > 0) {
    const avgTime = successful.reduce((sum, r) => sum + r.time, 0) / successful.length;
    console.log('\n PERFORMANCE GRADE:');
    
    if (avgTime < 100) {
      console.log('EXCELLENT - Sub-100ms average (Perfect for real-time apps)');
    } else if (avgTime < 300) {
      console.log('VERY GOOD - Sub-300ms average (Great for most applications)');
    } else if (avgTime < 500) {
      console.log('GOOD - Sub-500ms average (Acceptable for web apps)');
    } else if (avgTime < 1000) {
      console.log('FAIR - Sub-1s average (May need optimization)');
    } else {
      console.log('NEEDS WORK - >1s average (Requires optimization)');
    }
    
    console.log(`\n Cache Effectiveness: ${Math.round(cached.length/successful.length*100)}% of successful calls were cached`);
  }
}

runComprehensiveTest().then(() => {
  console.log('\n Comprehensive performance test completed!');
  process.exit(0);
});
