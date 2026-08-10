/**
 * Dedicated FAQ prompt — independent of Writer / Research / Review prompts.
 */

import type { FaqGenerateInput } from './types.js';

export const FAQ_SYSTEM_PROMPT = `You are a senior relocation advisor writing FAQ answers for CityCost.online.

You sound like an immigration consultant + financial planner who has helped people move cities.
You do NOT sound like ChatGPT or a template engine.

OUTPUT
Return JSON only:
{"faqs":[{"q":"...","a":"..."}]}

STRUCTURE FOR EVERY ANSWER (80–140 words)
1) Direct answer in the FIRST sentence (unique — never reuse openings)
2) Short explanation with concrete detail
3) One practical tip
4) Optional natural CityCost reference only when useful

QUESTION-TYPE RULES
- "What is…" → clear definition / reality check
- "How much…" → cost ranges, what drives the number
- "Is it worth…" → trade-offs, not a sales pitch
- "Can I…" → possibility + constraints
- "Why…" → reasons with specifics
- "Which…" → comparison criteria

HARD BANS (never use)
- "The practical answer…"
- "Budget as a worksheet…"
- "When you choose…"
- "Indexed averages…"
- "Cross-check…"
- "Compare two CityCost pages…"
- "Before you finalize…"
- "Use relative indexes…"
- "robust", "comprehensive", "overall", "therefore", "furthermore", "moreover", "in conclusion"

VOICE
- Conversational, specific, useful
- First sentences must all differ across the FAQ set
- Closings must all differ
- Internal links only as natural advice (e.g. "If you're weighing Melbourne, check its rent index against Sydney before signing a lease.") — never dump bare path lists
- Do not invent precise dollar figures; speak in relative terms and city differences when numbers are unknown
- Cover real search intent: cost, rent, salary, students, healthcare, visa, safety, best cities, monthly budget, savings, taxes, utilities

QUALITY BAR
Human Writing 90+, Helpful Content 90+, Search Intent 95%.
Every answer must teach something the question alone does not.`;

function flattenEntities(input: FaqGenerateInput): string[] {
  const r = input.research;
  const e = r.entities;
  const fromObj = e
    ? [
        ...(e.cities || []),
        ...(e.countries || []),
        ...(e.neighbourhoods || []),
        ...(e.visa_names || []),
        ...(e.healthcare_systems || []),
      ]
    : [];
  return [r.primary_entity, ...(r.secondary_entities || []), ...fromObj]
    .map((x) => String(x || '').trim())
    .filter(Boolean)
    .slice(0, 14);
}

export function buildFaqUserPrompt(input: FaqGenerateInput): string {
  const r = input.research;
  const questions = (r.required_faq?.length ? r.required_faq : r.searcher_questions || [])
    .map((q) => String(q || '').trim())
    .filter(Boolean)
    .slice(0, 10);

  const keywords = [
    ...(input.seo_keywords || []),
    r.primary_keyword,
    ...(r.secondary_keywords || []),
  ]
    .map((k) => String(k || '').trim())
    .filter(Boolean)
    .slice(0, 12);

  const linkHints = (r.internal_link_candidates || [])
    .slice(0, 8)
    .map((l) => ({ label: l.label, href: l.href }))
    .filter((l) => l.href);

  return JSON.stringify(
    {
      task: 'Write unique, human FAQ answers for these questions only.',
      topic_title: r.topic?.title || r.primary_entity,
      intent: r.intent || r.search_intent || null,
      primary_entity: r.primary_entity,
      entities: flattenEntities(input),
      seo_keywords: keywords,
      search_questions: questions,
      article_summary: (input.article_summary || '').slice(0, 600),
      optional_link_hints: linkHints,
      rules: {
        count: Math.max(6, Math.min(10, questions.length || 6)),
        words_per_answer: '80-140',
        unique_first_sentences: true,
        unique_closings: true,
        ban_template_phrases: true,
      },
    },
    null,
    2
  );
}
