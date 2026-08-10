/**
 * Regression tests — writer v2 error preservation + word floor import.
 */
import { expandDraftToMinWords } from '../lib/editorial-engine/revision/revision-validator.ts';
import {
  categorizeWriterError,
  formatGenerateFailureMessage,
  resolveWriterV2Failure,
  sanitizeWriterErrorMessage,
} from '../lib/editorial-engine/writer/writer-error.ts';
import { countDraftWords } from '../lib/editorial-engine/writer/draft-validate.ts';
import type { WriterDraftPayload } from '../lib/editorial-engine/writer/draft-validate.ts';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function ok(name: string): void {
  console.log(`  ✓ ${name}`);
  passed += 1;
}

let passed = 0;

function thinDraft(wordsTarget: number): WriterDraftPayload {
  const chunk =
    'Housing usually dominates monthly spend, then food and transport. Build a three-line budget and stress-test rent against take-home pay before you commit.';
  const blocks = [];
  let words = 0;
  let i = 0;
  while (words < wordsTarget) {
    blocks.push({
      id: `p-${i}`,
      type: 'paragraph' as const,
      content: `${chunk} Section ${i + 1}.`,
    });
    words = countDraftWords({
      seo_title: 'Test',
      meta_title: 'Test',
      meta_description: 'Test',
      excerpt: 'Test',
      blocks,
    });
    i += 1;
  }
  return {
    seo_title: 'Test comparison',
    meta_title: 'Test',
    meta_description: 'Test meta',
    excerpt: 'Test excerpt',
    blocks: [
      { id: 'intro', type: 'intro', content: 'Intro paragraph for testing word floor expansion.' },
      { id: 'toc', type: 'list', heading: 'Table of contents', content: ['Overview'] },
      ...blocks,
      {
        id: 'faq',
        type: 'faq',
        heading: 'FAQ',
        content: [{ q: 'Q1?', a: 'A1.' }],
      },
      { id: 'summary', type: 'summary', heading: 'Summary', content: 'Summary text.' },
    ],
  };
}

console.log('verify-writer-error-propagation');

{
  const raw =
    "Cannot find module 'D:\\\\path\\\\lib\\\\editorial-engine\\\\writer\\\\revision\\\\revision-validator.js'";
  const safe = sanitizeWriterErrorMessage(raw);
  assert(/Module load failed/i.test(safe), 'module paths sanitized');
  assert(!/D:\\\\path/i.test(safe), 'full path stripped from client message');
  assert(categorizeWriterError(raw) === 'module_error', 'module_error category');
  ok('sanitize module-not-found errors');
}

{
  const v2 = resolveWriterV2Failure({
    ok: false,
    message: 'Writer Engine v2 failed',
    errors: ['word_count_below_minimum:1971<2200'],
  });
  assert(v2.message.includes('1971'), 'uses errors[0] not generic wrapper');
  assert(v2.error_category === 'word_count', 'word_count category from errors');
  ok('resolveWriterV2Failure prefers errors[] over generic message');
}

{
  const formatted = formatGenerateFailureMessage('word_count_below_minimum:1971<2200', {
    failed_stage: 'quality_audit',
    error_category: 'word_count',
  });
  assert(/quality audit/i.test(formatted), 'includes failed stage');
  assert(/1971/.test(formatted), 'includes underlying reason');
  ok('formatGenerateFailureMessage includes stage + reason');
}

{
  const draft = thinDraft(1971);
  const before = countDraftWords(draft);
  assert(before < 2200, 'fixture below minimum');
  const expanded = expandDraftToMinWords(draft, 2200);
  assert(expanded.words >= 2200, `word floor expands to min (got ${expanded.words})`);
  ok('expandDraftToMinWords reaches article_length_min');
}

{
  // Static import path used by orchestrator must resolve
  assert(typeof expandDraftToMinWords === 'function', 'revision-validator import resolves');
  ok('orchestrator word-floor import path is valid');
}

console.log(`\n${passed} checks passed`);
