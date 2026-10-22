/**
 * Unit Test & Verification Script for CityCost RAG Pipeline & Claim-by-Claim Fact Checker
 */

import { strict as assert } from 'node:assert';
import {
  retrieveGroundedCityCostData,
  auditArticleClaimsAgainstRag,
  auditTextClaimsAgainstRag,
  type GroundedFact,
  type GroundingSource,
} from '../lib/editorial-engine/rag/index.js';

async function runRagTests() {
  console.log('🧪 Starting CityCost RAG Pipeline & Fact Checker Verification Tests...\n');

  // Test 1: Grounded Data Retrieval
  console.log('Test 1: Testing Grounded Retrieval for Austin...');
  const austinData = await retrieveGroundedCityCostData({
    targetCity: 'Austin',
    topicTitle: 'Austin Cost of Living 2026',
  });

  assert.ok(austinData, 'Austin data should be returned');
  assert.equal(austinData.targetCity, 'Austin');
  assert.ok(austinData.sources.length >= 2, 'Should return at least 2 grounding sources');
  assert.ok(austinData.facts.length >= 4, 'Should extract at least 4 grounded facts');
  assert.ok(
    austinData.sources.some((s) => s.domain.includes('citycost.org') || s.domain.includes('bls.gov')),
    'Should contain authoritative domains'
  );
  console.log(`  ✅ Retrieved ${austinData.sources.length} sources and ${austinData.facts.length} facts.\n`);

  // Test 2: Comparison Retrieval (Austin vs Seattle)
  console.log('Test 2: Testing Comparison Grounded Retrieval (Austin vs Seattle)...');
  const compData = await retrieveGroundedCityCostData({
    targetCity: 'Austin',
    comparisonCity: 'Seattle',
  });
  assert.equal(compData.comparisonCity, 'Seattle');
  assert.ok(compData.facts.some((f) => f.statement.includes('Austin')));
  assert.ok(compData.facts.some((f) => f.statement.includes('Seattle')));
  console.log(`  ✅ Successfully grounded comparative dataset with ${compData.facts.length} facts.\n`);

  // Test 3: Verified Claim-by-Claim Auditing (Within 15% tolerance)
  console.log('Test 3: Testing Claim Fact Checker on Accurate Draft...');
  const accurateDraft = `In Austin, Texas, median 1-bedroom apartment rent is $1,520/month. Monthly utilities average $190/month. CapMetro monthly transit passes cost $41.25/month. Texas levies 0% state income tax. Single adult groceries average $410/month.`;

  const reportPass = auditTextClaimsAgainstRag(accurateDraft, austinData.facts, austinData.sources);
  assert.ok(reportPass.totalClaims >= 4, 'Should extract at least 4 quantitative claims');
  assert.equal(reportPass.disputedCount, 0, 'Accurate claims should have 0 disputed claims');
  assert.ok(reportPass.accuracyScore >= 80, `Score should be >= 80%, got ${reportPass.accuracyScore}%`);
  assert.equal(reportPass.passed, true, 'Audit gate should pass for accurate draft');
  console.log(`  ✅ Accurate draft passed with score ${reportPass.accuracyScore}% (${reportPass.verifiedCount}/${reportPass.totalClaims} verified).\n`);

  // Test 4: Discrepancy Detection Gate (Halts when false numbers are presented)
  console.log('Test 4: Testing Claim Discrepancy Gate on Inaccurate Draft...');
  const falseDraft = `In Austin, Texas, median 1-bedroom apartment rent is $2,850/month. CapMetro transit pass costs $195/month. Texas levies a 12% state income tax.`;

  const reportFail = auditTextClaimsAgainstRag(falseDraft, austinData.facts, austinData.sources);
  assert.ok(reportFail.disputedCount >= 2, `Should flag at least 2 disputed claims, got ${reportFail.disputedCount}`);
  assert.equal(reportFail.passed, false, 'Audit gate MUST fail on disputed claims');
  assert.ok(
    reportFail.claims.some((c) => c.status === 'disputed' && c.discrepancyNote?.includes('discrepancy')),
    'Disputed claims should have discrepancy explanations'
  );
  console.log(`  ✅ Discrepancy gate successfully caught ${reportFail.disputedCount} false claims and blocked publishing.\n`);

  // Test 5: Inline Citation Footnote Mapping [^1]
  console.log('Test 5: Testing Inline Footnote Citation Matching...');
  const citedDraft = `Median housing in Austin is $1,520/month [^1]. Energy bills run $190/month [^2].`;
  const reportCited = auditTextClaimsAgainstRag(citedDraft, austinData.facts, austinData.sources);
  const claim1 = reportCited.claims[0];
  assert.equal(claim1.status, 'verified');
  assert.equal(claim1.matchedSourceId, 1);
  console.log(`  ✅ Footnote [^1] matched source: ${claim1.matchedSourceTitle} (${claim1.matchedSourceUrl})\n`);

  console.log('🎉 All 5 RAG Pipeline & Fact Checker unit verification tests PASSED!\n');
}

runRagTests().catch((err) => {
  console.error('❌ RAG Pipeline Test Failed:', err);
  process.exit(1);
});
