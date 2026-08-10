/**
 * Research-grounded draft synthesizer — used when model passes under-write.
 * Builds prose ONLY from Research Pack fields (no invented statistics).
 * Section-aware: each H2 kind uses distinct openers, rhythm, and pads.
 */

import { buildDeterministicFaqItems } from '../faq/faq-deterministic.js';
import { toFaqBlock } from '../faq/faq-apply.js';
import type { ResearchPack } from './research-engine.js';
import type { DraftBlock, WriterDraftPayload } from './draft-validate.js';
import { normalizeGuideFamily, type GuideFamily } from './guide-contracts.js';
import { sectionKind, type SectionKind } from './section-strategies.js';
import { openerFor } from './section-prose.js';
import { curatedLinksForWriter } from './link-validate.js';

function joinSentences(parts: string[]): string {
  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hashSeed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function cleanFactLine(fact: string): string {
  return fact
    .replace(/^Country signals for\s+/i, 'Planning signals for ')
    .replace(/^Indexed averages for\s+/i, 'Planning signals for ')
    .replace(/\bavg CPI\b/gi, 'average cost index')
    .replace(/\bavg rent index\b/gi, 'average rent index')
    .replace(/\bCertification batch\b[^.]*\.?/gi, '')
    .replace(/\bSupporting\s+\w+\s+spoke\b[^.]*\.?/gi, '')
    .replace(/\brobust\b/gi, 'solid')
    .replace(/\bcross-check\b/gi, 'compare')
    .trim();
}

function mdLink(href: string, label: string): string {
  return `[${label}](${href})`;
}

function placeLabel(r: ResearchPack): {
  place: string;
  cities: string[];
  exampleCities: string[];
  guideFamily: GuideFamily;
} {
  const guideFamily = normalizeGuideFamily(r.topic?.content_type);
  const titleVs = String(r.topic?.title || '').match(
    /\b([A-Z][A-Za-z .'-]+?)\s+vs\.?\s+([A-Z][A-Za-z .'-]+?)(?:\s+Cost|\s*\(|:|,|$)/
  );
  const allCities = (r.entities?.cities || []).filter(Boolean);
  const country =
    r.entities?.countries?.[0] ||
    (guideFamily === 'country' ? r.primary_entity : null) ||
    null;

  if (guideFamily === 'country') {
    const place = String(country || r.primary_entity || r.topic.title);
    const exampleCities = allCities.filter((c) => c.toLowerCase() !== place.toLowerCase()).slice(0, 6);
    return { place, cities: exampleCities.slice(0, 2), exampleCities, guideFamily };
  }

  if (guideFamily === 'comparison') {
    const cities = (
      titleVs
        ? [titleVs[1].trim(), titleVs[2].trim()]
        : allCities.slice(0, 2)
    ).filter(Boolean);
    const place =
      cities.length >= 2 ? `${cities[0]} and ${cities[1]}` : r.primary_entity || r.topic.title;
    return { place, cities, exampleCities: cities, guideFamily };
  }

  // City / supporting — one primary place
  const place = String(r.primary_entity || allCities[0] || r.topic.title);
  const cities = allCities.slice(0, 3);
  return { place, cities, exampleCities: cities, guideFamily };
}

function expandSection(opts: {
  heading: string;
  research: ResearchPack;
  minWords: number;
  sectionIndex?: number;
  /** Prevents the same pad sentence from appearing in multiple sections. */
  usedPads?: Set<string>;
}): string {
  const r = opts.research;
  const { place, cities, exampleCities, guideFamily } = placeLabel(r);
  const heading = opts.heading.replace(/^FAQ:\s*/i, '').trim();
  const kind = sectionKind(heading) as SectionKind;
  const curated = curatedLinksForWriter(r, 8);
  const linkMeta = (r.internal_link_candidates || []).concat(r.related_cities || []);
  const linkA = curated[0] || '/methodology';
  const linkB = curated[1] || '/data-sources';
  const labelA = linkMeta.find((l) => l.href === linkA)?.label || 'city page';
  const labelB = linkMeta.find((l) => l.href === linkB)?.label || 'data sources';
  const facts = (r.supporting_facts || []).slice(0, 6);
  const pains = (r.user_pain_points || []).slice(0, 4);
  const criteria = (r.decision_criteria || []).slice(0, 4);
  const mistakes = (r.common_mistakes || []).slice(0, 4);
  const neighbourhoods = (r.entities?.neighbourhoods || []).slice(0, 4);
  const transportOpts = (r.entities?.transportation || []).slice(0, 3);
  const healthcare = (r.entities?.healthcare_systems || []).slice(0, 2);
  const seed = (opts.sectionIndex ?? 0) + hashSeed(heading + kind + place + guideFamily);
  const fact = cleanFactLine(facts[seed % Math.max(1, facts.length)] || '');
  const fact2 = cleanFactLine(facts[(seed + 2) % Math.max(1, facts.length)] || '');
  const pain = pains[seed % Math.max(1, pains.length)] || '';
  const criterion = criteria[seed % Math.max(1, criteria.length)] || '';
  const mistake = mistakes[seed % Math.max(1, mistakes.length)] || '';

  const articleSeed = hashSeed(place + String(r.topic?.id || r.topic?.title || '') + guideFamily);
  const chunks = openerFor(kind, articleSeed + seed, {
    place,
    cities,
    exampleCities,
    guideFamily,
    heading,
    fact,
    fact2,
    pain,
    criterion,
    mistake,
    neighbourhoods,
    transportOpts,
    healthcare,
    labelA,
    labelB,
    linkA,
    linkB,
    mdLink,
  });

  if (fact2 && fact2 !== fact && seed % 3 === 0 && !['intro', 'summary', 'pros', 'cons'].includes(kind)) {
    chunks.splice(Math.min(2, chunks.length), 0, fact2);
  }

  let text = joinSentences(chunks);
  const count = () => text.split(/\s+/).filter(Boolean).length;

  // Kind-exclusive pads only — never reuse a global advice bank across sections
  const padsByKind: Partial<Record<SectionKind, string[]>> = {
    housing: [
      ` Ask what ${place} rent includes before you trust the listing number.`,
      guideFamily === 'country' && exampleCities.length
        ? ` City examples (${exampleCities.slice(0, 3).join(', ')}) show how wide housing can swing — they are samples, not the whole country.`
        : ` Neighbourhood choice usually moves housing more than a headline average.`,
    ],
    food: [
      ` Separate grocery weeks from dining-out weeks in ${place}.`,
      ` Regional produce and import habits change the food line faster than people expect.`,
    ],
    transport: [
      ` Price ${place} transit against a car only after you know the real commute pattern.`,
      ` Parking and insurance belong in the car total, not as afterthoughts.`,
    ],
    healthcare: [
      ` Confirm ${place} coverage rules for your status before you copy a resident's story.`,
      ` Keep an emergency medical buffer even when insurance looks complete.`,
    ],
    salary: [
      ` Affordability in ${place} is take-home after housing — not the offer headline.`,
      ` Convert offers to monthly cash before you judge lifestyle room.`,
    ],
    overview: [
      guideFamily === 'country'
        ? ` Build a national stack first; add city examples only after the country lines are honest.`
        : ` Keep the monthly stack simple: housing, food, transport, healthcare, setup.`,
    ],
    who: [
      ` Different audiences need different stress tests in ${place}.`,
    ],
    pros: [
      ` Name upsides that show up in after-rent cash for ${place}.`,
    ],
    cons: [
      ` Name frictions that create invoices — deposits, timing, thin rental choice.`,
    ],
    comparison:
      guideFamily === 'comparison' && cities.length >= 2
        ? [` Put ${cities[0]} and ${cities[1]} totals on one line each, then stare at the gap.`]
        : guideFamily === 'country'
          ? [` Map regional spreads inside ${place}; do not shrink the country to two cities.`]
          : [` Contrast neighbourhoods inside ${place} with lifestyle held constant.`],
    summary: [
      guideFamily === 'country'
        ? ` Finish with a national recommendation and a short city shortlist — not a recycled tips list.`
        : ` Finish with a clear recommendation and next actions unique to this section.`,
    ],
  };

  const pads = padsByKind[kind] || [
    ` Keep ${heading.toLowerCase()} tied to monthly cash impact in ${place}.`,
  ];
  const used = opts.usedPads;
  // At most one unused pad — never loop shared "seasonal spikes / shared housing" filler
  for (const pad of pads) {
    if (count() >= opts.minWords) break;
    const padKey = pad.trim().toLowerCase().slice(0, 48);
    if (used?.has(padKey)) continue;
    if (text.includes(pad.trim().slice(0, 28))) continue;
    text = `${text}${pad}`.trim();
    used?.add(padKey);
    break;
  }
  // If still short, expand with kind-specific factual restatement — not cross-section advice
  if (count() < opts.minWords) {
    const filler = ` Keep the ${heading.toLowerCase()} line for ${place} conservative until a real quote arrives.`;
    const fk = filler.toLowerCase().slice(0, 48);
    if (!used?.has(fk)) {
      text = `${text}${filler}`.trim();
      used?.add(fk);
    }
  }

  const maxSection = Math.max(opts.minWords + 40, Math.round(opts.minWords * 1.2));
  if (count() > maxSection) {
    text = text.split(/\s+/).slice(0, maxSection).join(' ');
  }
  return text;
}

/**
 * Build a complete draft strictly from the Research Pack outline/facts.
 */
export function synthesizeDraftFromResearch(
  research: ResearchPack,
  opts?: { targetWords?: number }
): WriterDraftPayload {
  const target = opts?.targetWords ?? 2700;
  const h2 = research.required_h2?.length
    ? research.required_h2
    : [
        'Introduction',
        'Who should read this',
        'Cost of living overview',
        'Housing',
        'Food',
        'Transport',
        'Healthcare',
        'Salary and purchasing power',
        'Pros',
        'Cons',
        'Summary',
        'FAQ',
      ];
  const bodyH2 = h2.filter((h) => !/^(introduction|faq|summary)$/i.test(h.trim()));
  const per = Math.max(140, Math.min(210, Math.round((target - 500) / Math.max(6, bodyH2.length))));
  const blocks: DraftBlock[] = [];
  const usedPads = new Set<string>();

  blocks.push({
    id: 'intro',
    type: 'intro',
    content: expandSection({
      heading: 'Introduction',
      research,
      minWords: 170,
      sectionIndex: 0,
      usedPads,
    }),
  });
  blocks.push({
    id: 'toc',
    type: 'list',
    heading: 'Table of contents',
    content: h2,
  });

  for (let i = 0; i < bodyH2.length; i++) {
    const heading = bodyH2[i];
    blocks.push({
      id: `h-${i}`,
      type: 'heading',
      heading,
      content: heading,
    });
    blocks.push({
      id: `p-${i}`,
      type: 'paragraph',
      content: expandSection({ heading, research, minWords: per, sectionIndex: i + 1, usedPads }),
    });
  }

  if ((research.required_tables || []).length) {
    blocks.push({
      id: 'table-main',
      type: 'table',
      heading: research.required_tables[0],
      content: {
        headers: ['Budget area', 'What to verify', 'Planning note'],
        rows: [
          ['Housing', 'City rent pages + listing inclusions', 'Include deposit and utilities'],
          ['Food', 'Grocery vs dining habits', 'Separate the two lines'],
          ['Transport', 'Pass vs car total cost', 'Test a week before annual fees'],
          ['Healthcare', 'Eligibility + GP visit price', 'Keep an emergency buffer'],
          ['Setup cash', 'Temporary stay + bonds', 'Do not mix with monthly rent'],
        ],
      },
    });
  }

  const guideFamily = normalizeGuideFamily(research.topic?.content_type);
  if (
    guideFamily === 'comparison' &&
    (research.required_comparison_blocks || []).some((x) => !/optional/i.test(x))
  ) {
    blocks.push({
      id: 'comparison-main',
      type: 'comparison',
      heading: research.required_comparison_blocks[0],
      content: {
        left: research.entities?.cities?.[0] || 'Option A',
        right: research.entities?.cities?.[1] || 'Option B',
        points: (research.decision_criteria || []).slice(0, 5),
        note: cleanFactLine((research.supporting_facts || [])[0] || '') ||
          'Compare after-rent cash with lifestyle held constant.',
      },
    });
  }

  const faqQuestions = (research.required_faq?.length
    ? research.required_faq
    : (research.searcher_questions || []).slice(0, 8)
  ).slice(0, 8);
  const faqItems = buildDeterministicFaqItems(research as never, faqQuestions);
  blocks.push(toFaqBlock(faqItems));

  blocks.push({
    id: 'summary',
    type: 'summary',
    heading: 'Summary',
    content: expandSection({
      heading: 'Summary and next steps',
      research,
      minWords: 140,
      sectionIndex: 99,
      usedPads,
    }),
  });

  // Natural tip — curated same-country / intent links only
  const curated = curatedLinksForWriter(research, 3);
  const linkIndex = new Map(
    [...(research.internal_link_candidates || []), ...(research.related_cities || [])].map((l) => [
      l.href,
      l.label || l.href,
    ])
  );
  const topLinks = curated.map((href) => mdLink(href, linkIndex.get(href) || href));
  if (topLinks.length) {
    blocks.push({
      id: 'links-tip',
      type: 'tip',
      heading: 'Useful pages while you plan',
      content:
        guideFamily === 'country'
          ? `When a city quote looks off for this country, check ${topLinks.join(', ')} as examples — then return to your national budget stack.`
          : `When a neighbourhood quote looks off, compare it against ${topLinks.join(', ')} before you change your housing range.`,
    });
  }

  const title = research.topic?.title || research.primary_entity || 'Cost of Living Guide';
  const kw = research.primary_keyword || 'cost of living';
  const place = research.primary_entity || research.topic?.title || 'your destination';
  let metaDescription = `Practical ${kw} guide: housing, food, and transport trade-offs with honest planning limits for relocators.`;
  while (metaDescription.length < 150) {
    metaDescription = `${metaDescription.replace(/\.$/, '')} Clear next steps.`;
  }
  if (metaDescription.length > 160) metaDescription = `${metaDescription.slice(0, 159).trim()}…`;

  const draft: WriterDraftPayload = {
    seo_title: title.slice(0, 60),
    meta_title: title.slice(0, 60),
    meta_description: metaDescription.slice(0, 160),
    excerpt: `A practical budgeting briefing for ${place}: housing trade-offs, food habits, transport choices, and first-month cash.`.slice(
      0,
      220
    ),
    blocks,
  };

  const maxWords = Math.min(3200, Math.max(target + 200, 2800));
  const wordCount = () =>
    draft.blocks
      .map((b) => (typeof b.content === 'string' ? b.content : JSON.stringify(b.content)))
      .join(' ')
      .split(/\s+/)
      .filter(Boolean).length;
  while (wordCount() > maxWords) {
    let longest: DraftBlock | null = null;
    let longestLen = 0;
    for (const b of draft.blocks) {
      if (typeof b.content !== 'string') continue;
      const n = b.content.split(/\s+/).length;
      if (n > longestLen && b.type === 'paragraph') {
        longest = b;
        longestLen = n;
      }
    }
    if (!longest || typeof longest.content !== 'string') break;
    longest.content = longest.content.split(/\s+/).slice(0, Math.max(80, longestLen - 40)).join(' ');
  }

  return draft;
}
