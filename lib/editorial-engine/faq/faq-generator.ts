/**
 * Dedicated FAQ generator — does not use Writer prompts or research-synth FAQ templates.
 */

import { getAiRouter } from '../ai/ai-router.js';
import type { ResearchPack } from '../research/schema.js';
import { buildDeterministicFaqItems } from './faq-deterministic.js';
import { toFaqBlock } from './faq-apply.js';
import { buildFaqUserPrompt, FAQ_SYSTEM_PROMPT } from './faq-prompt.js';
import { validateFaqItems } from './faq-validator.js';
import type { FaqGenerateInput, FaqGenerateResult, FaqItem } from './types.js';

function extractJson(raw: string): string {
  let s = raw.replace(/^\uFEFF/, '').trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) throw new Error('No JSON in FAQ response');
  return s.slice(start, end + 1);
}

function questionsFromResearch(research: ResearchPack): string[] {
  const list = (research.required_faq?.length
    ? research.required_faq
    : research.searcher_questions || []
  )
    .map((q) => String(q || '').trim())
    .filter(Boolean);
  return list.slice(0, 10);
}

function normalizeAiFaqs(raw: unknown, fallbackQuestions: string[]): FaqItem[] {
  const obj = raw && typeof raw === 'object' ? (raw as { faqs?: unknown; items?: unknown }) : {};
  const arr = Array.isArray(obj.faqs) ? obj.faqs : Array.isArray(obj.items) ? obj.items : [];
  const items: FaqItem[] = [];
  for (let i = 0; i < arr.length; i++) {
    const row = arr[i];
    if (!row || typeof row !== 'object') continue;
    const r = row as { q?: string; a?: string; question?: string; answer?: string };
    const q = String(r.q || r.question || fallbackQuestions[i] || '').trim();
    const a = String(r.a || r.answer || '').trim();
    if (q && a) items.push({ q, a, id: `faq-${i + 1}` });
  }
  // Ensure question coverage from research pack
  for (let i = 0; i < fallbackQuestions.length; i++) {
    const need = fallbackQuestions[i]!;
    if (!items.some((it) => it.q.toLowerCase() === need.toLowerCase())) {
      // leave gap — deterministic fill later
    }
  }
  return items;
}

async function generateWithAi(input: FaqGenerateInput): Promise<FaqItem[] | null> {
  const router = getAiRouter();
  if (!(await router.hasAnyProvider())) return null;
  const result = await router.complete({
    stage: 'faq',
    articleId: input.articleId ?? null,
    temperature: 0.55,
    maxTokens: 3500,
    jsonMode: true,
    system: FAQ_SYSTEM_PROMPT,
    user: buildFaqUserPrompt(input),
  });
  const parsed = JSON.parse(extractJson(result.text));
  const questions = questionsFromResearch(input.research);
  return normalizeAiFaqs(parsed, questions);
}

function mergeCoverage(aiItems: FaqItem[], research: ResearchPack): FaqItem[] {
  const questions = questionsFromResearch(research);
  const det = buildDeterministicFaqItems(research, questions);
  const byQ = new Map(aiItems.map((i) => [i.q.toLowerCase(), i]));
  const out: FaqItem[] = [];
  for (const q of questions.length ? questions : det.map((d) => d.q)) {
    const existing = byQ.get(q.toLowerCase());
    if (existing) out.push({ ...existing, q });
    else {
      const d = det.find((x) => x.q.toLowerCase() === q.toLowerCase()) || det[out.length];
      if (d) out.push({ q, a: d.a, id: d.id });
    }
  }
  if (out.length < 6) {
    for (const d of det) {
      if (out.length >= 6) break;
      if (!out.some((o) => o.q.toLowerCase() === d.q.toLowerCase())) out.push(d);
    }
  }
  return out.slice(0, 10);
}

/**
 * Generate a dedicated FAQ block from research + article summary only.
 */
export async function generateDedicatedFaqs(
  input: FaqGenerateInput
): Promise<FaqGenerateResult> {
  const questions = questionsFromResearch(input.research);
  let source: FaqGenerateResult['source'] = 'deterministic';
  let items: FaqItem[] = buildDeterministicFaqItems(input.research, questions);

  if (input.preferDeterministic) {
    const validation = validateFaqItems(items);
    const block = toFaqBlock(items);
    return {
      ok: validation.ok || validation.scores.human_writing >= 85,
      items,
      block,
      validation,
      source,
      message: `FAQ generated via ${source} · ${items.length} items · human ${validation.scores.human_writing}`,
    };
  }

  try {
    const aiItems = await generateWithAi(input);
    if (aiItems?.length) {
      const merged = mergeCoverage(aiItems, input.research);
      const aiValidation = validateFaqItems(merged);
      if (aiValidation.ok || aiValidation.scores.human_writing >= 80) {
        items = merged;
        source = aiItems.length >= merged.length ? 'ai' : 'mixed';
      } else {
        // One repair pass: ask model again with failure notes
        try {
          const router = getAiRouter();
          const repair = await router.complete({
            stage: 'faq',
            articleId: input.articleId ?? null,
            temperature: 0.45,
            maxTokens: 3500,
            jsonMode: true,
            system: FAQ_SYSTEM_PROMPT,
            user:
              buildFaqUserPrompt(input) +
              '\n\nPREVIOUS DRAFT FAILED VALIDATION:\n' +
              JSON.stringify(aiValidation.issues.slice(0, 12)) +
              '\nRewrite all answers. Unique openings/closings. Zero banned phrases.',
          });
          const repaired = normalizeAiFaqs(
            JSON.parse(extractJson(repair.text)),
            questions
          );
          const merged2 = mergeCoverage(repaired, input.research);
          const v2 = validateFaqItems(merged2);
          if (v2.ok || v2.scores.human_writing > aiValidation.scores.human_writing) {
            items = merged2;
            source = 'ai';
          }
        } catch {
          /* keep deterministic */
        }
      }
    }
  } catch {
    source = 'deterministic';
    items = buildDeterministicFaqItems(input.research, questions);
  }

  // Final safety: if still failing bans, force deterministic
  let validation = validateFaqItems(items);
  if (!validation.ok && validation.issues.some((i) => i.code === 'banned_phrase')) {
    items = buildDeterministicFaqItems(input.research, questions);
    source = 'deterministic';
    validation = validateFaqItems(items);
  }

  const block = toFaqBlock(items);
  return {
    ok: validation.ok || validation.scores.human_writing >= 85,
    items,
    block,
    validation,
    source,
    message: `FAQ generated via ${source} · ${items.length} items · human ${validation.scores.human_writing}`,
  };
}
