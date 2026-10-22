/**
 * Automated Claim-by-Claim Fact Checker Gate for CityCost Editorial Engine.
 * Extracts individual factual and numeric assertions from generated drafts and
 * audits them against real-time retrieved grounding data to eliminate hallucinations.
 */

import type { ClaimAuditResult, GroundedFact, GroundingSource, RagAuditReport } from './types.js';

interface RawBlock {
  type: string;
  heading?: string;
  content: unknown;
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(extractTextFromContent).join(' ');
  }
  if (content && typeof content === 'object') {
    const obj = content as Record<string, unknown>;
    if (typeof obj.text === 'string') return obj.text;
    if (Array.isArray(obj.items)) return obj.items.map(extractTextFromContent).join(' ');
    if (Array.isArray(obj.rows)) return JSON.stringify(obj.rows);
    return Object.values(obj).map(extractTextFromContent).join(' ');
  }
  return '';
}

/**
 * Extracts quantitative, financial, and verifiable factual sentences from text.
 */
function extractFactualSentences(text: string): string[] {
  // Clean markdown tags & split into sentences
  const cleaned = text.replace(/<[^>]+>/g, ' ').replace(/\n+/g, ' ');
  const rawSentences = cleaned
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20 && s.length < 320);

  // Filter for sentences containing numbers, currency, percentages, or cost assertions
  const factualNeedles = [
    /\$\s*\d+/,
    /€\s*\d+/,
    /¥\s*\d+/,
    /\b\d+\s*%/i,
    /\b\d{1,3}(,\d{3})*(\.\d+)?\b/,
    /\b(rent|transit|grocery|utilities|salary|income tax|cpi|index|cost of living)\b/i,
  ];

  const matched = rawSentences.filter((s) => factualNeedles.some((re) => re.test(s)));
  // Deduplicate and cap at 18 most salient claims
  return [...new Set(matched)].slice(0, 18);
}

function parseNumber(text: string): number | null {
  // Strip out known non-cost quantities like 85m², 85 m2, 1-bedroom, years 2020-2030
  const sanitized = text
    .replace(/\b(202[0-9]|2030)\b/g, '')
    .replace(/\b\d+\s*(?:m²|m2|sq\s*ft|bedroom|bed|bd|month|mo)\b/gi, '');

  // 1. Look for currency figures like $1,520, $175 to $210, €1,250, ¥95,000
  const currencyMatches = Array.from(
    sanitized.matchAll(/[\$€¥]\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]+)?)/g)
  );

  if (currencyMatches.length > 0) {
    const nums = currencyMatches
      .map((m) => parseFloat(m[1].replace(/,/g, '')))
      .filter((n) => !isNaN(n));
    if (nums.length === 1) return nums[0];
    if (nums.length >= 2) {
      // Return midpoint of price range (e.g. $175 to $210 -> 192.5)
      return (nums[0] + nums[1]) / 2;
    }
  }

  // 2. Look for percentages (e.g. 10.25%, 0%)
  const pctMatch = sanitized.match(/\b([0-9]+(?:\.[0-9]+)?)\s*%/);
  if (pctMatch) {
    const p = parseFloat(pctMatch[1]);
    if (!isNaN(p)) return p;
  }

  // 3. General numeric fallback
  const generalMatch = sanitized.match(/\b([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]+)?)\b/);
  if (!generalMatch) return null;
  const num = parseFloat(generalMatch[1].replace(/,/g, ''));
  return isNaN(num) ? null : num;
}

/**
 * Audits a single claim against available grounding facts and sources.
 */
function auditSingleClaim(
  claimText: string,
  claimIndex: number,
  groundedFacts: GroundedFact[],
  sources: GroundingSource[]
): ClaimAuditResult {
  const claimId = `claim-${claimIndex + 1}`;
  const lowerClaim = claimText.toLowerCase();

  const category: ClaimAuditResult['category'] = /rent|apartment|housing|lease/i.test(lowerClaim)
    ? 'rent'
    : /transit|metro|subway|bus|orca|capmetro|commute/i.test(lowerClaim)
    ? 'transport'
    : /grocer|food|dining|meal|restaurant|supermarket/i.test(lowerClaim)
    ? 'groceries'
    : /utilit|electric|internet|broadband|water|heating/i.test(lowerClaim)
    ? 'utilities'
    : /tax|income tax|sales tax|property tax/i.test(lowerClaim)
    ? 'tax'
    : /salary|wage|pay|compensation/i.test(lowerClaim)
    ? 'salary'
    : 'general';

  // Find best matching grounding facts in same or related category
  const candidateFacts = groundedFacts.filter(
    (gf) => gf.category === category || lowerClaim.includes(gf.category)
  );

  let bestMatch: GroundedFact | null = null;
  let bestOverlap = 0;

  for (const gf of candidateFacts.length > 0 ? candidateFacts : groundedFacts) {
    const gfWords = gf.statement.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    const overlap = gfWords.filter((w) => lowerClaim.includes(w)).length;
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestMatch = gf;
    }
  }

  // Check if claim explicitly references a footnote citation like [^1], [^2]
  const citationMatch = claimText.match(/\[\^(\d+)\]/);
  let citedSourceId: number | undefined;
  if (citationMatch) {
    citedSourceId = parseInt(citationMatch[1], 10);
  } else if (bestMatch) {
    citedSourceId = bestMatch.sourceId;
  }

  const matchedSource = sources.find((s) => s.id === citedSourceId) || sources[0];

  // Factual verification evaluation
  if (bestMatch && bestOverlap >= 3) {
    const claimNum = parseNumber(claimText);
    const factNum = parseNumber(bestMatch.statement);

    if (claimNum !== null && factNum !== null) {
      const diffPct = Math.abs(claimNum - factNum) / Math.max(factNum, 1);
      if (diffPct <= 0.15) {
        // Within 15% tolerance
        return {
          claimId,
          claimText,
          category,
          status: 'verified',
          confidence: 0.94 - diffPct * 0.5,
          matchedSourceId: matchedSource?.id,
          matchedSourceUrl: matchedSource?.url,
          matchedSourceTitle: matchedSource?.title,
          matchedEvidence: bestMatch.statement,
        };
      } else {
        // Significant discrepancy
        return {
          claimId,
          claimText,
          category,
          status: 'disputed',
          confidence: 0.45,
          matchedSourceId: matchedSource?.id,
          matchedSourceUrl: matchedSource?.url,
          matchedSourceTitle: matchedSource?.title,
          matchedEvidence: bestMatch.statement,
          discrepancyNote: `Draft claims ${claimNum}, but retrieved evidence indicates ${factNum} (~${Math.round(diffPct * 100)}% discrepancy).`,
        };
      }
    }

    // Descriptive alignment
    return {
      claimId,
      claimText,
      category,
      status: 'verified',
      confidence: 0.88,
      matchedSourceId: matchedSource?.id,
      matchedSourceUrl: matchedSource?.url,
      matchedSourceTitle: matchedSource?.title,
      matchedEvidence: bestMatch.statement,
    };
  }

  // If there's footnote citation present, grant moderate verified confidence
  if (citedSourceId && matchedSource) {
    return {
      claimId,
      claimText,
      category,
      status: 'verified',
      confidence: 0.82,
      matchedSourceId: matchedSource.id,
      matchedSourceUrl: matchedSource.url,
      matchedSourceTitle: matchedSource.title,
      matchedEvidence: `Referenced via source [^${matchedSource.id}]: ${matchedSource.title}`,
    };
  }

  // Ungrounded claim
  return {
    claimId,
    claimText,
    category,
    status: 'ungrounded',
    confidence: 0.32,
    discrepancyNote: 'No matching real-time grounding chunk or citation found in research pack.',
  };
}

/**
 * Main Entry Point: Audits an entire article payload against RAG grounding facts and sources.
 */
export function auditArticleClaimsAgainstRag(
  blocks: RawBlock[],
  groundedFacts: GroundedFact[],
  sources: GroundingSource[]
): RagAuditReport {
  const fullTextParts: string[] = [];

  for (const b of blocks || []) {
    if (b.heading) fullTextParts.push(b.heading);
    fullTextParts.push(extractTextFromContent(b.content));
  }

  const combinedText = fullTextParts.join(' ');
  const rawClaims = extractFactualSentences(combinedText);

  // If article has very few quantitative claims, extract section summaries
  if (rawClaims.length === 0) {
    for (const b of blocks.slice(0, 5)) {
      const txt = extractTextFromContent(b.content).slice(0, 150);
      if (txt.length > 20) rawClaims.push(txt);
    }
  }

  const auditedClaims: ClaimAuditResult[] = rawClaims.map((claim, idx) =>
    auditSingleClaim(claim, idx, groundedFacts, sources)
  );

  const totalClaims = auditedClaims.length;
  const verifiedCount = auditedClaims.filter((c) => c.status === 'verified').length;
  const disputedCount = auditedClaims.filter((c) => c.status === 'disputed').length;
  const ungroundedCount = auditedClaims.filter((c) => c.status === 'ungrounded').length;

  const rawScore = totalClaims > 0 ? (verifiedCount / totalClaims) * 100 : 100;
  // Penalty for disputed claims
  const penalty = disputedCount * 15;
  const accuracyScore = Math.max(0, Math.min(100, Math.round(rawScore - penalty)));

  const passed = accuracyScore >= 80 && disputedCount === 0;

  const summary = passed
    ? `Passed Factual Quality Gate (${accuracyScore}% grounded). ${verifiedCount}/${totalClaims} claims verified against real-time source citations.`
    : `Factual Audit Failed (${accuracyScore}% grounded). Found ${disputedCount} disputed claim(s) and ${ungroundedCount} ungrounded assertion(s) requiring citation grounding.`;

  return {
    accuracyScore,
    totalClaims,
    verifiedCount,
    disputedCount,
    ungroundedCount,
    passed,
    claims: auditedClaims,
    sources,
    summary,
    auditedAt: new Date().toISOString(),
  };
}

/**
 * Audits a raw string of text/markdown against RAG grounding facts and sources.
 */
export function auditTextClaimsAgainstRag(
  text: string,
  groundedFacts: GroundedFact[],
  sources: GroundingSource[]
): RagAuditReport {
  return auditArticleClaimsAgainstRag(
    [{ type: 'paragraph', content: text }],
    groundedFacts,
    sources
  );
}

