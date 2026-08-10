/**
 * Optional SEO polish via AI Router (never calls a provider SDK directly).
 * Deterministic buildSeoPackage remains the source of truth on failure.
 */

import { getAiRouter } from '../ai/ai-router.js';
import type { SeoPackage } from './seo-package.js';

export async function polishSeoMetaWithRouter(
  seo: SeoPackage,
  opts?: { articleId?: number | null }
): Promise<SeoPackage> {
  try {
    const router = getAiRouter();
    if (!router.isConfigured()) return seo;
    const result = await router.complete({
      model: undefined,
      stage: 'seo',
      temperature: 0.3,
      maxTokens: 220,
      jsonMode: true,
      articleId: opts?.articleId ?? null,
      system:
        'You refine SEO meta for CityCost.online. Return JSON {"meta_title":"","meta_description":""}. Title ≤60 chars. Meta description 150–160 chars. Include primary keyword naturally. No hype.',
      user: JSON.stringify({
        primary_keyword: seo.primary_keyword,
        current_title: seo.meta_title,
        current_description: seo.meta_description,
      }),
    });
    const parsed = JSON.parse(result.text) as {
      meta_title?: string;
      meta_description?: string;
    };
    const meta_title = (parsed.meta_title || seo.meta_title).replace(/\s+/g, ' ').trim().slice(0, 60);
    let meta_description = (parsed.meta_description || seo.meta_description)
      .replace(/\s+/g, ' ')
      .trim();
    if (meta_description.length > 160) meta_description = meta_description.slice(0, 160);
    if (meta_description.length < 120) return seo;
    return {
      ...seo,
      meta_title,
      meta_description,
      seo_title: seo.seo_title || meta_title,
      og: { ...seo.og, title: meta_title, description: meta_description },
      twitter: { ...seo.twitter, title: meta_title, description: meta_description },
    };
  } catch {
    return seo;
  }
}
