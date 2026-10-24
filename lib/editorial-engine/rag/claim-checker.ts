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
    /[\$€¥£₹]\s*\d+/,
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
    sanitized.matchAll(/[\$€¥£₹]\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?)/g)
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

const STOPWORDS = new Set([
  'about', 'after', 'average', 'around', 'approximately', 'between', 'costs', 'monthly', 'month',
  'there', 'their', 'these', 'those', 'which', 'while', 'with', 'from', 'that', 'this', 'than',
  'into', 'over', 'under', 'per', 'year', 'roughly', 'typically', 'typical', 'median',
]);

function contentWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w));
}

function cityName(city: string | undefined): string | null {
  if (!city) return null;
  const n = city.split(',')[0].trim().toLowerCase();
  return n.length > 1 ? n : null;
}

function factSourceIds(gf: GroundedFact): number[] {
  return gf.sourceIds?.length ? gf.sourceIds : [gf.sourceId];
}

/**
 * Audits a single claim against available grounding facts and sources.
 * A claim is `verified` only when a retrieved fact matches it (and its figure is
 * within tolerance). A footnote on its own never verifies a claim.
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
    : /transit|metro|subway|bus|train|fare|commute/i.test(lowerClaim)
    ? 'transport'
    : /grocer|food|dining|meal|restaurant|supermarket/i.test(lowerClaim)
    ? 'groceries'
    : /utilit|electric|internet|broadband|water|heating/i.test(lowerClaim)
    ? 'utilities'
    : /\btax\b|income tax|sales tax|property tax|vat/i.test(lowerClaim)
    ? 'tax'
    : /salary|wage|pay|compensation/i.test(lowerClaim)
    ? 'salary'
    : 'general';

  // Footnote(s) or inline markdown link(s) in the claim restrict evidence to the cited source(s).
  const citedIds = [...claimText.matchAll(/\[\^(\d+)\]/g)].map((m) => parseInt(m[1], 10));

  const markdownLinks = [...claimText.matchAll(/\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/g)].map((m) => ({
    title: m[1].trim().toLowerCase(),
    url: m[2].trim().toLowerCase(),
  }));

  for (const link of markdownLinks) {
    const matched = sources.find((s) => {
      const sUrl = (s.url || '').toLowerCase();
      const sDomain = (s.domain || '').toLowerCase();
      const sTitle = (s.title || '').toLowerCase();
      return (
        (link.url && (sUrl.includes(link.url) || link.url.includes(sUrl) || (sDomain && link.url.includes(sDomain)))) ||
        (link.title && (sTitle.includes(link.title) || link.title.includes(sTitle)))
      );
    });
    if (matched && !citedIds.includes(matched.id)) {
      citedIds.push(matched.id);
    }
  }

  const unknownCited = citedIds.filter((id) => !sources.some((s) => s.id === id));
  if (citedIds.length && unknownCited.length === citedIds.length) {
    return {
      claimId,
      claimText,
      category,
      status: 'ungrounded',
      confidence: 0.2,
      discrepancyNote: `Cites [^${unknownCited[0]}], which is not a retrieved source.`,
    };
  }

  // Never match evidence about a different city than the one the claim names.
  const claimCities = new Set(
    groundedFacts.map((gf) => cityName(gf.city)).filter((c): c is string => !!c && lowerClaim.includes(c))
  );
  let pool = groundedFacts.filter((gf) => {
    const c = cityName(gf.city);
    return !c || claimCities.size === 0 || claimCities.has(c);
  });
  if (citedIds.length) {
    pool = pool.filter((gf) => factSourceIds(gf).some((id) => citedIds.includes(id)));
  }
  const sameCategory = pool.filter((gf) => gf.category === category);
  const candidates = sameCategory.length ? sameCategory : pool;

  const claimWords = new Set(contentWords(claimText));
  let bestMatch: GroundedFact | null = null;
  let bestOverlap = 0;
  for (const gf of candidates) {
    const overlap = new Set(contentWords(gf.statement).filter((w) => claimWords.has(w))).size;
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestMatch = gf;
    }
  }

  if (!bestMatch || bestOverlap < 3) {
    return {
      claimId,
      claimText,
      category,
      status: 'ungrounded',
      confidence: 0.3,
      discrepancyNote: citedIds.length
        ? `Cites [^${citedIds[0]}], but that source backs no matching statement in the research pack.`
        : 'No matching source-backed statement found in the research pack.',
    };
  }

  const matchedSourceId = citedIds.find((id) => factSourceIds(bestMatch!).includes(id)) ?? bestMatch.sourceId;
  const matchedSource = sources.find((s) => s.id === matchedSourceId);
  const sourceFields = {
    matchedSourceId: matchedSource?.id,
    matchedSourceUrl: matchedSource?.url,
    matchedSourceTitle: matchedSource?.title,
    matchedEvidence: bestMatch.statement,
  };

  const claimNum = parseNumber(claimText);
  const factNum = parseNumber(bestMatch.statement);
  if (claimNum !== null && factNum !== null) {
    const diffPct = Math.abs(claimNum - factNum) / Math.max(Math.abs(factNum), 1);
    if (diffPct <= 0.15) {
      return {
        claimId,
        claimText,
        category,
        status: 'verified',
        confidence: Math.round((0.94 - diffPct * 0.5) * 100) / 100,
        ...sourceFields,
      };
    }
    return {
      claimId,
      claimText,
      category,
      status: 'disputed',
      confidence: 0.45,
      ...sourceFields,
      discrepancyNote: `Draft claims ${claimNum}, but retrieved evidence indicates ${factNum} (~${Math.round(diffPct * 100)}% discrepancy).`,
    };
  }

  if (claimNum !== null && factNum === null) {
    // The claim states a figure the evidence does not contain.
    return {
      claimId,
      claimText,
      category,
      status: 'ungrounded',
      confidence: 0.4,
      ...sourceFields,
      discrepancyNote: 'Related evidence found, but it does not state this figure.',
    };
  }

  // Descriptive (non-numeric) claim aligned with evidence.
  return { claimId, claimText, category, status: 'verified', confidence: 0.8, ...sourceFields };
}

/**
 * Main Entry Point: Audits an entire article payload against RAG grounding facts and sources.
 * With no grounded evidence the report is `no_evidence` (no score) rather than a fake pass/fail.
 */
export function auditArticleClaimsAgainstRag(
  blocks: RawBlock[],
  groundedFacts: GroundedFact[],
  sources: GroundingSource[]
): RagAuditReport {
  const facts = Array.isArray(groundedFacts) ? groundedFacts : [];
  const srcs = Array.isArray(sources) ? sources : [];
  const fullTextParts: string[] = [];

  for (const b of blocks || []) {
    if (b.heading) fullTextParts.push(b.heading);
    fullTextParts.push(extractTextFromContent(b.content));
  }

  const rawClaims = extractFactualSentences(fullTextParts.join(' '));

  if (facts.length === 0) {
    return {
      status: 'no_evidence',
      accuracyScore: null,
      totalClaims: rawClaims.length,
      verifiedCount: 0,
      disputedCount: 0,
      ungroundedCount: 0,
      passed: false,
      claims: [],
      sources: srcs,
      summary: `Not audited — no live grounded evidence is attached (${rawClaims.length} quantitative claim(s) found).`,
      auditedAt: new Date().toISOString(),
    };
  }

  const auditedClaims: ClaimAuditResult[] = rawClaims.map((claim, idx) =>
    auditSingleClaim(claim, idx, facts, srcs)
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
    ? `Passed Factual Quality Gate (${accuracyScore}% grounded). ${verifiedCount}/${totalClaims} claims matched source-backed evidence.`
    : `Factual Audit Failed (${accuracyScore}% grounded). Found ${disputedCount} disputed claim(s) and ${ungroundedCount} ungrounded assertion(s) requiring citation grounding.`;

  return {
    status: 'audited',
    accuracyScore,
    totalClaims,
    verifiedCount,
    disputedCount,
    ungroundedCount,
    passed,
    claims: auditedClaims,
    sources: srcs,
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

