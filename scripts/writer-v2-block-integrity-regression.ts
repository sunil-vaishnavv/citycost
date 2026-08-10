/**
 * Regression: Draft Block Integrity — protected structure + unique IDs survive
 * sanitize → humanize (body-only merge) → similarity rewrite → ensureDraftIntegrity.
 *
 * Run: npx tsx scripts/writer-v2-block-integrity-regression.ts
 */

import assert from 'node:assert/strict';
import {
  sanitizeBlocks,
  type DraftBlock,
  type WriterDraftPayload,
} from '../lib/editorial-engine/writer/draft-validate.js';
import {
  ensureDraftIntegrity,
  formatIntegrityMeta,
  inspectDraftIntegrity,
  isProtectedBlock,
  mergeWithProtected,
  mintBlockId,
  resetBlockIdFactoryForTests,
  snapshotProtected,
  splitProtectedBlocks,
  uniquifyBlockIds,
  type ProtectedSnapshot,
} from '../lib/editorial-engine/writer/v2/block-integrity.js';
import { humanizeDeterministic } from '../lib/editorial-engine/writer/v2/humanization.js';

const GUIDE_TYPES = [
  'Country',
  'City',
  'Comparison',
  'Salary',
  'Rent',
  'Visa',
  'Student',
  'Food',
  'Healthcare',
  'Moving',
  'Travel',
  'Budget',
  'Retirement',
] as const;

function longPara(seed: string): string {
  return (
    `${seed} Housing usually dominates monthly spend, then food and transport. ` +
    `Build a three-line budget, stress-test rent for your neighbourhood, and keep a buffer ` +
    `for utilities, healthcare, and one-off setup fees before treating any citywide average as reliable.`
  );
}

function fixtureDraft(guideLabel: string): WriterDraftPayload {
  const title = `${guideLabel} cost of living planning guide`;
  const headings = [
    `${guideLabel} overview`,
    'Housing costs',
    'Everyday spending',
    'Practical next steps',
  ];
  const blocks: DraftBlock[] = [
    {
      id: 'intro',
      type: 'intro',
      content: longPara(`Introduction for ${guideLabel}.`),
    },
    {
      id: 'toc',
      type: 'list',
      heading: 'Table of contents',
      content: headings,
    },
    ...headings.flatMap((h, i) => [
      {
        id: `h-${i}`,
        type: 'heading' as const,
        heading: h,
        content: h,
      },
      {
        id: `b-${i}`,
        type: 'paragraph' as const,
        content: longPara(`Section ${h} for ${guideLabel}.`),
      },
    ]),
    {
      id: 'faq',
      type: 'faq',
      heading: 'FAQ',
      content: [
        {
          q: `What drives costs for a ${guideLabel.toLowerCase()} guide?`,
          a: 'Housing usually dominates, then food and transport; verify with local quotes.',
        },
        {
          q: 'Should I trust a single monthly total?',
          a: 'No. Use a three-line budget and stress-test rent for your neighbourhood.',
        },
      ],
    },
    {
      id: 'summary',
      type: 'summary',
      heading: 'Summary',
      content: longPara(`Summary for ${guideLabel}.`),
    },
  ];
  return {
    seo_title: title.slice(0, 70),
    meta_title: title.slice(0, 60),
    meta_description: `Practical notes for ${title}`.slice(0, 160),
    excerpt: `Practical notes for ${title}`.slice(0, 220),
    blocks,
  };
}

function assertIntegrityPass(label: string, draft: WriterDraftPayload, snap: ProtectedSnapshot) {
  const { draft: fixed, report, restored } = ensureDraftIntegrity(draft, snap, {
    outlineHeadings: ['Overview', 'Housing', 'Food'],
  });
  assert.equal(
    report.integrity,
    'PASS',
    `[${label}] integrity FAIL: ${formatIntegrityMeta(report)}; restored=${restored.join(',')}`
  );
  assert.equal(report.duplicate_ids.length, 0, `[${label}] duplicate ids: ${report.duplicate_ids}`);
  assert.equal(report.intro, 'present', `[${label}] missing intro`);
  assert.equal(report.toc, 'present', `[${label}] missing toc`);
  assert.equal(report.faq, 'present', `[${label}] missing faq`);
  assert.equal(report.summary, 'present', `[${label}] missing summary`);
  assert.ok(report.order_valid, `[${label}] order invalid: ${report.notes.join(';')}`);
  const ids = fixed.blocks.map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length, `[${label}] uniquify failed`);
  return fixed;
}

function simulateSimilarityBodyRewrite(draft: WriterDraftPayload, snap: ProtectedSnapshot): WriterDraftPayload {
  const { body } = splitProtectedBlocks(draft.blocks);
  // Corrupt AI response: duplicate id b-26, no intro/toc/faq/summary
  const corruptedBody: DraftBlock[] = [
    ...body.map((b, i) => ({
      ...b,
      id: i === 0 ? 'b-26' : b.id,
      content:
        typeof b.content === 'string'
          ? b.content.replace(/\s+/g, ' ').trim()
          : b.content,
    })),
    {
      id: 'b-26',
      type: 'paragraph',
      content: longPara('Duplicate collision paragraph injected by similarity rewrite.'),
    },
  ];
  const merged = mergeWithProtected(
    sanitizeBlocks(corruptedBody).filter((b) => !isProtectedBlock(b)),
    snap
  );
  return { ...draft, blocks: merged };
}

function simulateHumanizeDropProtected(draft: WriterDraftPayload, snap: ProtectedSnapshot): WriterDraftPayload {
  const { body } = splitProtectedBlocks(draft.blocks);
  // AI returns body only (drops intro/toc/faq/summary) — same as humanizeWithAi path
  const rewritten = body.map((b) => {
    if (typeof b.content !== 'string') return { ...b, id: '' };
    return {
      ...b,
      id: '',
      content: String(b.content).replace(/\bleverage\b/gi, 'use').replace(/\s{2,}/g, ' ').trim(),
    };
  });
  const newBody = sanitizeBlocks(rewritten).filter((b) => !isProtectedBlock(b));
  return { ...draft, blocks: mergeWithProtected(newBody, snap) };
}

console.log('=== Writer v2 block integrity regression ===\n');
resetBlockIdFactoryForTests();

let failed = 0;
let passed = 0;

for (const guide of GUIDE_TYPES) {
  const label = guide.toLowerCase();
  try {
    let draft = fixtureDraft(guide);
    draft = { ...draft, blocks: sanitizeBlocks(draft.blocks) };
    const snap = snapshotProtected(draft.blocks);
    assert.ok(snap.intro && snap.toc && snap.faq && snap.summary, `[${label}] snapshot incomplete`);

    // Path 1: sanitize → integrity
    draft = assertIntegrityPass(`${label}/sanitize`, draft, snap);

    // Path 2: humanize body-only merge
    draft = simulateHumanizeDropProtected(draft, snap);
    draft = humanizeDeterministic(draft);
    draft = assertIntegrityPass(`${label}/humanize`, draft, snap);

    // Path 3: similarity corruption (dup b-26 + drop protected)
    draft = simulateSimilarityBodyRewrite(draft, snap);
    // Explicit wipe intro+toc to force snapshot restore (Job #6 pattern)
    draft = {
      ...draft,
      blocks: draft.blocks.filter((b) => b.type !== 'intro' && b.id !== 'toc'),
    };
    const before = inspectDraftIntegrity(draft);
    assert.equal(before.intro, 'missing', `[${label}] expected missing intro before restore`);
    assert.equal(before.toc, 'missing', `[${label}] expected missing toc before restore`);
    draft = assertIntegrityPass(`${label}/similarity+restore`, draft, snap);

    // Path 4: uniquify after forced duplicate ids
    const withDupes: WriterDraftPayload = {
      ...draft,
      blocks: [
        ...draft.blocks,
        { id: 'b-26', type: 'paragraph', content: longPara('Extra dupe A.') },
        { id: 'b-26', type: 'paragraph', content: longPara('Extra dupe B.') },
      ],
    };
    const uniq = uniquifyBlockIds(withDupes.blocks);
    assert.equal(
      new Set(uniq.map((b) => b.id)).size,
      uniq.length,
      `[${label}] uniquify left duplicates`
    );
    draft = assertIntegrityPass(`${label}/uniquify`, { ...withDupes, blocks: uniq }, snap);

    // mint never reuses
    const a = mintBlockId('t');
    const b = mintBlockId('t');
    assert.notEqual(a, b, `[${label}] mintBlockId reused`);

    console.log(`PASS  ${label}  (${formatIntegrityMeta(inspectDraftIntegrity(draft))})`);
    passed += 1;
  } catch (err) {
    failed += 1;
    console.error(`FAIL  ${label}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Dedicated Job #6 style corruption simulation
try {
  const draft0 = fixtureDraft('City');
  const snap = snapshotProtected(sanitizeBlocks(draft0.blocks));
  let bad: WriterDraftPayload = {
    ...draft0,
    blocks: [
      { id: 'b-26', type: 'paragraph', content: longPara('Body A.') },
      { id: 'b-26', type: 'paragraph', content: longPara('Body B duplicate id.') },
      { id: 'h-1', type: 'heading', heading: 'Housing', content: 'Housing' },
      {
        id: 'faq',
        type: 'faq',
        heading: 'FAQ',
        content: [{ q: 'Q?', a: longPara('A.') }],
      },
      { id: 'summary', type: 'summary', heading: 'Summary', content: longPara('Sum.') },
      // intentionally no intro, no toc
    ],
  };
  const reportBefore = inspectDraftIntegrity(bad);
  assert.equal(reportBefore.integrity, 'FAIL');
  assert.ok(reportBefore.duplicate_ids.includes('b-26'));
  assert.equal(reportBefore.intro, 'missing');
  assert.equal(reportBefore.toc, 'missing');
  bad = assertIntegrityPass('job6-sim', bad, snap);
  console.log(`PASS  job6-corruption-sim  (${formatIntegrityMeta(inspectDraftIntegrity(bad))})`);
  passed += 1;
} catch (err) {
  failed += 1;
  console.error(`FAIL  job6-corruption-sim: ${err instanceof Error ? err.message : String(err)}`);
}

console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
console.log('PASS');
