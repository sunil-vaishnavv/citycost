/**
 * Independent Summary Writer — does not reuse body section templates.
 * Produces recommendation-focused summary; never pastes intro.
 */

import type { ResearchPack } from './research-engine.js';
import type { DraftBlock, WriterDraftPayload } from './draft-validate.js';
import { routeWriter } from './router.js';
import { normalizeGuideFamily } from './guide-contracts.js';
import { blockContentText } from '../reviewer/text-utils.js';

function placeOf(research: ResearchPack): { place: string; a?: string; b?: string; examples: string[] } {
  const family = normalizeGuideFamily(research.topic?.content_type);
  const cities = (research.entities?.cities || []).filter(Boolean);
  const country = research.entities?.countries?.[0] || research.primary_entity || research.topic.title;
  if (family === 'comparison' && cities.length >= 2) {
    return { place: `${cities[0]} vs ${cities[1]}`, a: cities[0], b: cities[1], examples: cities.slice(0, 2) };
  }
  if (family === 'country') {
    return {
      place: String(country),
      examples: cities.filter((c) => c.toLowerCase() !== String(country).toLowerCase()).slice(0, 5),
    };
  }
  return {
    place: String(research.primary_entity || cities[0] || research.topic.title),
    examples: cities.slice(0, 3),
  };
}

function introFingerprint(draft: WriterDraftPayload): Set<string> {
  const intro = (draft.blocks || []).find((b) => b.type === 'intro');
  const text = intro ? blockContentText(intro).toLowerCase() : '';
  return new Set(
    text
      .split(/\s+/)
      .filter((w) => w.length > 5)
      .slice(0, 40)
  );
}

/** Build a fresh summary block from research + writer brief (not body copy). */
export function writeSummaryBlock(
  research: ResearchPack,
  draft: WriterDraftPayload
): DraftBlock {
  const { writer } = routeWriter(research.topic?.content_type);
  const family = normalizeGuideFamily(research.topic?.content_type);
  const { place, a, b, examples } = placeOf(research);
  const introWords = introFingerprint(draft);

  let lines: string[] = [];
  if (family === 'country') {
    lines = [
      `Recommendation: treat ${place} as a national cost decision first — lock housing and healthcare assumptions before you fall in love with any single listing.`,
      examples.length
        ? `Shortlist city types using examples such as ${examples.slice(0, 4).join(', ')}, then verify local quotes in your top pick.`
        : `Shortlist two or three city types that match your rent ceiling, then verify local quotes.`,
      `Who should move: people who can fund a realistic housing share and accept regional cost spreads inside ${place}.`,
    ];
  } else if (family === 'comparison' && a && b) {
    lines = [
      `Recommendation: choose ${a} when your top criteria favour its cost/commute mix; choose ${b} when the reverse is true.`,
      `Hold lifestyle constant while you score both sides — a cheaper index on one line is not a win if deposits erase it.`,
      `Who should choose which: match your top two priorities to ${a} vs ${b}, then get quotes in both before you commit.`,
    ];
  } else if (family === 'city') {
    lines = [
      `Recommendation: ${place} works when your after-rent cash still clears food, transport, and a healthcare buffer.`,
      `This week: set a rent ceiling for ${place}, pick two neighbourhoods, and get written quotes before you stretch.`,
      `Who should move: people whose work or study location makes the commute and housing trade-off sustainable in ${place}.`,
    ];
  } else {
    lines = [
      writer.summary_brief.replace(/\.$/, '') + ` for ${place}.`,
      `Prioritise the focus lines that matter here: ${writer.focus_lines.slice(0, 3).join(', ')}.`,
      `Next step: write a monthly stack you can defend, then verify the swing line with real quotes.`,
    ];
  }

  // Drop any line that heavily overlaps intro wording
  lines = lines.filter((line) => {
    const words = line
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 5);
    const overlap = words.filter((w) => introWords.has(w)).length;
    return words.length < 4 || overlap / words.length < 0.5;
  });

  if (!lines.length) {
    lines = [
      `Recommendation: decide ${place} on after-rent cash, not vibes.`,
      `Act this week on housing range, then food and transport habits.`,
    ];
  }

  return {
    id: 'summary',
    type: 'summary',
    heading: 'Summary',
    content: lines.join(' '),
  };
}

/** Replace or append summary on a draft. */
export function applySummaryWriter(
  draft: WriterDraftPayload,
  research: ResearchPack
): WriterDraftPayload {
  const summary = writeSummaryBlock(research, draft);
  const blocks = [...(draft.blocks || [])];
  const idx = blocks.findIndex((b) => b.type === 'summary');
  if (idx >= 0) blocks[idx] = summary;
  else blocks.push(summary);
  // Drop orphan "Summary" heading duplication noise if content already typed summary
  return { ...draft, blocks };
}
