/**
 * Verification harness for regional cost estimation + currency logic.
 * Run: npx tsx scripts/verify-cost-estimate.ts
 */
import { estimateCityCost } from '../lib/cost-estimate.ts';

const pairs: Array<[string, string, { expectCheaper?: string; expectCurrency?: string; expectCrossCurrency?: [string, string] }]> = [
  ['Jaipur, Rajasthan, India', 'Pali, Rajasthan, India', { expectCheaper: 'Pali', expectCurrency: 'INR' }],
  ['Delhi, India', 'Mumbai, India', { expectCurrency: 'INR' }],
  ['Dubai, United Arab Emirates', 'Abu Dhabi, United Arab Emirates', { expectCurrency: 'AED' }],
  ['London, United Kingdom', 'Manchester, United Kingdom', { expectCheaper: 'Manchester', expectCurrency: 'GBP' }],
  ['New York, United States', 'Buffalo, United States', { expectCheaper: 'Buffalo', expectCurrency: 'USD' }],
  ['Tokyo, Japan', 'Osaka, Japan', { expectCheaper: 'Osaka', expectCurrency: 'JPY' }],
  ['Jaipur, Rajasthan, India', 'Dubai, United Arab Emirates', { expectCrossCurrency: ['INR', 'AED'] }],
  ['Jaipur, Rajasthan, India', 'London, United Kingdom', { expectCrossCurrency: ['INR', 'GBP'] }],
];

let failures = 0;

for (const [qa, qb, expect] of pairs) {
  const A = estimateCityCost(qa);
  const B = estimateCityCost(qb);
  const sameCur = A.currency === B.currency;
  const cheaper = A.indices.cpi_index <= B.indices.cpi_index ? A.city : B.city;

  console.log('\n===', A.city, 'vs', B.city, '===');
  console.log(
    `  A: ${A.currency} CPI=${A.indices.cpi_index} rent=${A.indices.rent_index} (${A.data_source}) ${A.confidence_label}`
  );
  console.log(
    `  B: ${B.currency} CPI=${B.indices.cpi_index} rent=${B.indices.rent_index} (${B.data_source}) ${B.confidence_label}`
  );
  console.log(
    `  cheaper=${cheaper} sameCurrency=${sameCur} 1br centre: ${A.symbol}${A.prices[0].average_price} vs ${B.symbol}${B.prices[0].average_price}`
  );

  if (expect.expectCurrency) {
    if (A.currency !== expect.expectCurrency || B.currency !== expect.expectCurrency) {
      console.log(`  FAIL currency expected ${expect.expectCurrency}, got ${A.currency}/${B.currency}`);
      failures++;
    } else {
      console.log(`  OK currency ${expect.expectCurrency}`);
    }
  }

  if (expect.expectCrossCurrency) {
    const [ca, cb] = expect.expectCrossCurrency;
    if (A.currency !== ca || B.currency !== cb || sameCur) {
      console.log(`  FAIL cross-currency expected ${ca}/${cb}, got ${A.currency}/${B.currency}`);
      failures++;
    } else {
      console.log(`  OK cross-currency ${ca} / ${cb}`);
    }
  }

  if (expect.expectCheaper) {
    if (cheaper !== expect.expectCheaper) {
      console.log(`  FAIL expected cheaper=${expect.expectCheaper}, got ${cheaper}`);
      failures++;
    } else {
      console.log(`  OK cheaper=${cheaper}`);
    }
  }
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
