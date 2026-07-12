import http from 'http';

async function testCity(cityName) {
  console.log(`\n🔍 Testing city: ${cityName}`);
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3001,
      path: `/api/city_prices?query=${encodeURIComponent(cityName)}`,
      method: 'GET'
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          console.log('✅ Response received:', {
            name: json.name,
            currency: json.currency,
            indices: json.indices,
            pricesCount: json.prices?.length
          });
          resolve(json);
        } catch (e) {
          console.error('❌ Failed to parse JSON:', data);
          reject(e);
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.end();
  });
}

async function main() {
  try {
    console.log('=== Starting API Tests ===');
    await testCity('London');
    await testCity('Dubai');
    await testCity('Delhi');
    await testCity('New York');
    console.log('\n🎉 All tests passed!');
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

main();
