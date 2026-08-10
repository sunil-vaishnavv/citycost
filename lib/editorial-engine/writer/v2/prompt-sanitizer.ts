/**
 * Prompt sanitizer — convert Research Pack into clean facts; strip planning vocabulary
 * before any Writer v2 AI call. Never send raw research JSON / planning labels to the model.
 */

import type { ResearchPack } from '../research-engine.js';

/** Phrases that must never appear in prompts sent to the model. */
export const PROMPT_PLANNING_BANS: Array<{ re: RegExp; repl: string }> = [
  { re: /\bindexed averages\b/gi, repl: 'cost indices' },
  { re: /\bindexed signals?\b/gi, repl: 'cost figures' },
  { re: /\bindexed city signals?\b/gi, repl: 'city cost figures' },
  { re: /\bcountry signals for\b/gi, repl: 'figures for' },
  { re: /\beditorial angle\b/gi, repl: '' },
  { re: /\bcitycost angle\b/gi, repl: '' },
  { re: /\bkeep the citycost angle\b/gi, repl: '' },
  { re: /\bsearch intent\b/gi, repl: '' },
  { re: /\brequired_h2\b/gi, repl: 'section headings' },
  { re: /\brequired_h2_count_min\b/gi, repl: '' },
  { re: /\bfacts_must_not_invent\b/gi, repl: 'use only provided facts' },
  { re: /\bcross-?check\b/gi, repl: 'verify' },
  { re: /\bdata sources\b/gi, repl: 'sources' },
  { re: /\bresearch notes?\b/gi, repl: '' },
  { re: /\beditorial notes?\b/gi, repl: '' },
  { re: /\binternal notes?\b/gi, repl: '' },
  { re: /\bplanning notes?\b/gi, repl: '' },
  { re: /\bdeveloper(?:\s+instructions?)?\b/gi, repl: '' },
  { re: /\bsystem_rules?\b/gi, repl: 'writing constraints' },
  { re: /\bJSON hints?\b/gi, repl: '' },
  { re: /\boutline hints?\b/gi, repl: '' },
  { re: /\bprompt(?:ing)? instructions?\b/gi, repl: '' },
  { re: /\bdo not invent statistics\b/gi, repl: 'only use numbers from the facts block' },
  { re: /\bhold lifestyle constant\b/gi, repl: 'compare similar living patterns' },
  { re: /\bcertification batch\b/gi, repl: '' },
  { re: /\bwrite for the persona\b/gi, repl: 'match the reader profile' },
  { re: /\breader_persona\b/gi, repl: 'reader' },
  { re: /\b"persona"\s*:/gi, repl: '"reader":' },
  { re: /\bdecision signal\b/gi, repl: 'result' },
  { re: /\boverall winner signal\b/gi, repl: 'overall cost winner' },
  { re: /\bsupporting spoke\b/gi, repl: '' },
  { re: /\bwriter_contract\b/gi, repl: '' },
  { re: /\bmust_follow_outline\b/gi, repl: '' },
  { re: /\bmust_use_pack_intent\b/gi, repl: '' },
  { re: /\bsole_source\b/gi, repl: '' },
];

/** Residual banned tokens — if still present after rewrite, strip the whole token/phrase. */
export const PROMPT_HARD_BAN_NEEDLES = [
  'indexed averages',
  'editorial angle',
  'search intent',
  'required_h2',
  'cross-check',
  'cross check',
  'citycost angle',
  'data sources',
  'research notes',
  'research note',
  'editorial note',
  'editorial notes',
  'internal notes',
  'internal note',
  'developer instruction',
  'planning notes',
  'facts_must_not_invent',
  'writer_contract',
  'country signals for',
];

export function sanitizePromptText(input: string): {
  text: string;
  scrub_count: number;
  banned_hits: string[];
} {
  let text = String(input || '');
  let scrub_count = 0;
  const banned_hits: string[] = [];

  for (const { re, repl } of PROMPT_PLANNING_BANS) {
    const next = text.replace(re, () => {
      scrub_count += 1;
      return repl;
    });
    text = next;
  }

  const lower = text.toLowerCase();
  for (const needle of PROMPT_HARD_BAN_NEEDLES) {
    if (lower.includes(needle)) {
      banned_hits.push(needle);
      const re = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      text = text.replace(re, () => {
        scrub_count += 1;
        return '';
      });
    }
  }

  text = text
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text, scrub_count, banned_hits: [...new Set(banned_hits)] };
}

function scrubLine(line: string): string | null {
  const { text, banned_hits } = sanitizePromptText(line);
  if (!text || text.length < 3) return null;
  // Drop lines that were mostly planning metadata
  if (banned_hits.length && text.split(/\s+/).length < 6) return null;
  return text;
}

/**
 * Build a writer-safe facts block from a Research Pack (or unknown).
 * Never dumps persona / search_intent / outline / required_h2 / writer_contract.
 */
export function buildFactsDigest(facts: unknown): string {
  const lines: string[] = [];

  if (facts && typeof facts === 'object') {
    const pack = facts as Partial<ResearchPack> & Record<string, unknown>;

    if (typeof pack.primary_entity === 'string' && pack.primary_entity.trim()) {
      lines.push(`Place: ${pack.primary_entity.trim()}`);
    }

    const ents = pack.entities as ResearchPack['entities'] | undefined;
    if (ents && typeof ents === 'object') {
      if (ents.cities?.length) lines.push(`Cities: ${ents.cities.slice(0, 8).join(', ')}`);
      if (ents.countries?.length) lines.push(`Countries: ${ents.countries.slice(0, 6).join(', ')}`);
      if (ents.currencies?.length) lines.push(`Currencies: ${ents.currencies.slice(0, 4).join(', ')}`);
      if (ents.neighbourhoods?.length) {
        lines.push(`Neighbourhoods: ${ents.neighbourhoods.slice(0, 6).join(', ')}`);
      }
    }

    const supporting = Array.isArray(pack.supporting_facts) ? pack.supporting_facts : [];
    const required = Array.isArray(pack.required_statistics) ? pack.required_statistics : [];
    const seen = new Set<string>();
    for (const raw of [...supporting, ...required].slice(0, 24)) {
      if (typeof raw !== 'string') continue;
      const cleaned = scrubLine(raw);
      if (!cleaned) continue;
      const key = cleaned.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(cleaned);
    }

    // Structured city / country numbers if present on pack (legacy nested)
    const city = pack.city as Record<string, unknown> | undefined;
    if (city && typeof city === 'object') {
      const name = typeof city.city === 'string' ? city.city : typeof city.name === 'string' ? city.name : null;
      const indices = city.indices as Record<string, unknown> | undefined;
      if (name && indices) {
        if (indices.cpi_index != null) lines.push(`Average Cost Index for ${name} = ${indices.cpi_index}`);
        if (indices.rent_index != null) lines.push(`Average Rent Index for ${name} = ${indices.rent_index}`);
      }
    }
    const country = pack.country as Record<string, unknown> | undefined;
    if (country && typeof country === 'object') {
      const name = typeof country.name === 'string' ? country.name : null;
      if (name) {
        if (country.avg_cpi != null) lines.push(`Average Cost Index for ${name} = ${country.avg_cpi}`);
        if (country.avg_rent != null) lines.push(`Average Rent Index for ${name} = ${country.avg_rent}`);
        if (typeof country.currency === 'string') lines.push(`Currency: ${country.currency}`);
      }
    }
  }

  if (!lines.length) {
    // Fallback: sanitize a truncated JSON dump but strip planning keys first
    try {
      const clone =
        facts && typeof facts === 'object'
          ? omitPlanningKeys(facts as Record<string, unknown>)
          : facts;
      const raw = JSON.stringify(clone ?? {});
      const { text } = sanitizePromptText(raw.slice(0, 8000));
      return text;
    } catch {
      return '';
    }
  }

  const body = lines.map((l) => `- ${l}`).join('\n');
  const { text, scrub_count, banned_hits } = sanitizePromptText(body);
  if (banned_hits.length) {
    console.warn(
      `[writer-v2] facts digest still had planning tokens after scrub (${scrub_count}): ${banned_hits.join(', ')}`
    );
  }
  return text.slice(0, 10000);
}

const PLANNING_KEYS = new Set([
  'search_intent',
  'intent',
  'persona',
  'reader_persona',
  'outline',
  'outline_sections',
  'required_h2',
  'writer_contract',
  'facts_must_not_invent',
  'disclaimer_requirements',
  'article_angle',
  'angle',
  'cluster_notes',
  'prompt_hints',
  'system_rules',
  'searcher_questions',
  'keywords',
  'secondary_keywords',
  'long_tail_keywords',
  'question_keywords',
  'semantic_keywords',
  'lsi_keywords',
]);

function omitPlanningKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (PLANNING_KEYS.has(k)) continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = omitPlanningKeys(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Assert prompt text is safe; returns scrubbed text + debug. */
export function assertCleanPrompt(
  label: string,
  input: string
): { text: string; scrub_count: number; banned_hits: string[]; label: string } {
  const result = sanitizePromptText(input);
  if (result.banned_hits.length) {
    console.warn(
      `[writer-v2] prompt sanitizer scrubbed ${label}: ${result.banned_hits.join(', ')} (scrub_count=${result.scrub_count})`
    );
  }
  return { ...result, label };
}
