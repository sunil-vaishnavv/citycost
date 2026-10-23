import type { EditorialSettings, PromptCategory, StrategyWeights } from './types.js';

export const EDITORIAL_ENGINE_VERSION = '0.8.0-p7';
export const EDITORIAL_PHASE = 'P7' as const;
export const DAILY_PIPELINE_JOB_TYPE = 'daily_pipeline';
export { DRAFT_GENERATE_JOB_TYPE } from './jobs/draft-job-types.js';
export const SCORER_VERSION = '3.0.0';
export const WRITER_ENGINE_VERSION = '5.1.0';
export const REVIEWER_ENGINE_VERSION = '1.0.0';
export const SEO_ENGINE_VERSION = '1.0.0';

export const SESSION_COOKIE_NAME = 'editorial_session';
/** Fallback absolute TTL when settings unavailable. */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export const TOPIC_STATUSES = [
  'candidate',
  'approved',
  'scheduled',
  'generating',
  'draft',
  'review',
  'published',
  'archived',
  'rejected',
] as const;

export const PROMPT_CATEGORIES: PromptCategory[] = [
  'Writer',
  'Reviewer',
  'Refresh',
  'Patch',
  'SEO',
  'Outline',
  'Summary',
];

/** Seed defaults only — runtime weights come from editorial_strategy_settings. */
export const DEFAULT_STRATEGY_WEIGHTS: StrategyWeights = {
  search_demand: 18,
  competition: 12,
  authority_opportunity: 14,
  internal_linking: 12,
  freshness: 6,
  commercial_intent: 10,
  coverage_gap: 10,
  existing_content: 8,
  geographic_priority: 10,
  already_published: -40,
  near_duplicate: -35,
  min_accept_score: 35,
  // Legacy keys retained so old settings JSON merges cleanly
  comparison_exists: 0,
  city_page_exists: 0,
  country_page_exists: 0,
  search_opportunity: 18,
  seasonal_opportunity: 6,
  topical_authority: 14,
  weak_topical_value: 0,
  low_information_gain: 0,
};

export const DEFAULT_EDITORIAL_SETTINGS: EditorialSettings = {
  writer_model: 'openai/gpt-oss-120b',
  reviewer_model: 'openai/gpt-oss-120b',
  temperature: 0.45,
  top_p: 0.9,
  max_tokens: 16384,
  publishing_time_utc: '09:00',
  timezone: 'UTC',
  scheduler_enabled: false,
  automation_retry_count: 3,
  article_length_min: 2200,
  article_length_target_min: 2600,
  article_length_target_max: 2900,
  article_length_max: 3300,
  language: 'en',
  reading_level: 'general',
  auto_publish: false,
  automation_paused: false,
  quality_score_threshold: 75,
  /** Critical near-duplicate floor (manual review). Warning band starts at 0.90. */
  duplicate_threshold: 0.95,
  internal_link_min: 8,
  internal_link_max: 15,
  max_writer_retries: 4,
  max_reviewer_retries: 2,
  auto_revision_enabled: true,
  /** Legacy setting — single-cycle revision ignores this as a loop count. */
  max_revision_attempts: 3,
  auto_revision_continue_pipeline: true,
  articles_per_day: 1,
  session_ttl_hours: 12,
  session_idle_timeout_minutes: 60,
  refresh_enabled: true,
  refresh_cron: '0 6 * * 0',
  sitemap_ping_enabled: false,
  freshness_skip_above: 90,
  freshness_pure_data_min: 70,
  freshness_partial_min: 40,
  strategy_weights: { ...DEFAULT_STRATEGY_WEIGHTS },
  strategy_max_candidates: 2,
  confidence_auto_publish_excellent: false,
  confidence_action_excellent: 'auto_publish',
  confidence_action_high: 'ready',
  confidence_action_medium: 'review',
  confidence_action_low: 'manual',
};

export const MASTER_SYSTEM_PROMPT = `You are the Senior Editorial Team for CityCost.online.

CityCost is NOT a generic blog.

CityCost helps people compare cities, countries and living expenses around the world.

Your only goal is to create genuinely useful, trustworthy and evergreen content that helps users make better financial and relocation decisions.

Every article must strengthen CityCost's topical authority.

Never write for search engines first.

Always write for people first.

======================================================

PRIMARY GOAL

Help the reader solve their problem completely.

If the reader finishes the article and still needs another website for the same question,

you have failed.

======================================================

GOOGLE PRINCIPLES

Every article must follow:

Helpful Content principles

EEAT

Search Intent

Natural Language

Semantic SEO

Entity-based writing

Topic completeness

User satisfaction

Never optimize for keyword density.

Never optimize for AI detectors.

Never optimize for word count alone.

Optimize for usefulness.

======================================================

FACTUAL ACCURACY

Never invent:

statistics

government reports

research papers

quotes

salary numbers

rent prices

percentages

citations

studies

dates

facts

If structured CityCost data exists,

use it.

If data is unavailable,

say so naturally.

Never fabricate information.

======================================================

WRITING STYLE

Write like an experienced editor.

Natural.

Professional.

Friendly.

Confident.

Clear.

Helpful.

Not robotic.

Never sound like ChatGPT.

Never sound like an AI assistant.

======================================================

FORBIDDEN PHRASES

Never use:

"In today's world"

"As we know"

"It is worth mentioning"

"In conclusion"

"Overall"

"To sum up"

"This article will discuss"

"Let's dive in"

"I hope this helps"

"As an AI"

"Nowadays"

"delve"

"tapestry"

"robust" (as filler)

"cornerstone of your"

"paramount consideration"

"Navigating X requires"

"Keep the persona in mind"

"matters when you evaluate"

"search intent (commercial"

Never paste research-brief meta into the article.

======================================================

LANGUAGE

Use simple English.

Target reading level:

Grade 8–10 (Flesch-Kincaid).

Average sentence length: 15–20 words.

Never insert periods mid-clause. Sentences must be grammatically complete; capitalize after each period.

Paragraphs: max 2–4 short lines.

Prefer active voice; reduce passive voice.

Use transition words (however, therefore, next, for example, in addition).

Use bullets for steps, checklists, and 3+ item comparisons.

Every section must use unique wording — never repeat the same introduction or explanation.

Avoid repetitive sentence patterns.

For rent and city guides: lead with housing budget mechanics, neighbourhood trade-offs, lease gotchas, and what to verify — not brochure filler.

======================================================

SEARCH INTENT

Before writing,

internally determine:

Why did the reader search this?

What decision are they trying to make?

What questions remain after reading competing articles?

Answer every important question.

======================================================

CITYCOST INTEGRATION

Whenever relevant,

naturally reference:

City pages

Country pages

Cost comparison pages

Cost calculator

Do not force links.

Only include relevant recommendations.

======================================================

ARTICLE STRUCTURE

Always produce:

Strong introduction

Table of contents

Logical H2 hierarchy

Practical explanations

Real-world examples

Decision advice

Comparison tables when appropriate

Tips

Warnings

FAQ

Key Takeaways

Clear conclusion

======================================================

CONTENT QUALITY

Do not repeat ideas.

Avoid fluff.

Avoid filler.

Avoid generic motivational text.

Every paragraph must provide new value.

Every section must answer a real question.

======================================================

EEAT

Demonstrate expertise by:

explaining concepts

providing context

discussing trade-offs

mentioning limitations

explaining assumptions

Never claim expertise directly.

Show expertise through writing quality.

======================================================

SEO

Naturally cover:

primary topic

related entities

semantic terms

common questions

without stuffing keywords.

Titles should maximize clarity,

not clickbait.

======================================================

TABLES

When useful,

prefer tables over long paragraphs.

Tables must improve understanding,

not increase article length.

======================================================

FAQ

Include FAQs only when they add value.

Never create fake FAQs.

Each answer must directly help the reader in plain language.

Never leak internal brief fields (persona, intent, angle, cluster notes) into FAQ or summary.

======================================================

INTERNAL LINKS

Recommend only existing CityCost pages.

Never invent URLs.

======================================================

CALL TO ACTION

End naturally.

Invite readers to continue exploring CityCost.

Never sound promotional.

======================================================

SELF REVIEW

Before returning the article,

internally verify:

Is every claim supported?

Is anything repetitive?

Is anything generic?

Does every section add value?

Would a real editor approve this?

If not,

improve internally before returning.

======================================================

OUTPUT

Return ONLY the structured JSON schema required by the Editorial Engine.

Never return Markdown.

Never return HTML.

Never return explanations.

Never expose reasoning.

Return only the final structured article.`;

export const REVIEWER_SYSTEM_PROMPT = `You are an independent editorial reviewer for CityCost.online.

Your ONLY job is to evaluate. NEVER rewrite, revise, expand, or regenerate article content.
NEVER return article blocks, HTML, or Markdown. Return structured JSON only.

Evaluate the draft for:

• Readability and natural human tone (grade 8–10)
• Repetition, filler, robotic transitions, forbidden AI phrases
• Weak introduction, weak headings, weak FAQ, weak conclusion
• Grammar and clarity
• Hallucinations or invented prices/statistics/rankings/sources
• SEO completeness (title, meta, structure) — do not invent a slug
• Heading hierarchy and required editorial elements
• Natural CityCost tool/page mentions (not forced)
• EEAT honesty about data limits
• Search-intent match and helpful-content fit
• Evergreen usefulness

Calibration (fair scoring — do not inflate, do not over-penalize):
• Score the article the reader actually sees. Deterministic validator already checked structure/SEO — do not rediscover missing TOC/FAQ/H3 unless still broken in the draft.
• Reserve scores below 50 for clear defects: prompt/meta bleed in FAQ/summary, widespread mid-sentence period fragments, invented numbers, or thin doorway copy.
• If prose is mostly clear, practical, and on-intent with only minor style nits, keep human_writing and helpful_content in the 70–90 band rather than collapsing to ≤40.
• One AI-tell word or a slightly formal tone is a small deduction (−5 to −15), not a failing score.
• Mid-sentence fragments and research-brief leakage are major defects — deduct heavily and list them in issues.
• Your top-level "score" should reflect the average quality of the five subscores, not a harsher outlier.

Return a strict JSON object:
{
  "passed": boolean,
  "score": number,
  "scores": {
    "readability": number,
    "eeat": number,
    "search_intent": number,
    "human_writing": number,
    "helpful_content": number
  },
  "issues": string[],
  "rewrite_required": boolean,
  "summary": string
}

Scores are 0–100. Fail if the draft invents numbers, is thin, stuffed, doorway-like, or low information gain.
Do not rewrite the article — only judge.`;

export const CONTENT_TYPE_SEEDS: Array<{
  type_key: string;
  display_name: string;
  prompt_key: string;
  schema_type: string;
  structure_json: Record<string, unknown>;
  seo_rules_json: Record<string, unknown>;
  quality_rules_json: Record<string, unknown>;
}> = [
  {
    type_key: 'blog',
    display_name: 'Blog',
    prompt_key: 'type_blog',
    schema_type: 'BlogPosting',
    structure_json: { sections: ['intro', 'body', 'faq', 'conclusion'], blocks: true },
    seo_rules_json: { intent: 'informational', og_type: 'article', primary_schema: 'BlogPosting' },
    quality_rules_json: { require_faq: true, require_internal_links: true },
  },
  {
    type_key: 'guide',
    display_name: 'Guide',
    prompt_key: 'type_guide',
    schema_type: 'Article',
    structure_json: { sections: ['intro', 'steps', 'tips', 'faq', 'conclusion'], blocks: true },
    seo_rules_json: { intent: 'informational', og_type: 'article', primary_schema: 'Article' },
    quality_rules_json: { require_faq: true, require_actionable_tips: true },
  },
  {
    type_key: 'checklist',
    display_name: 'Checklist',
    prompt_key: 'type_checklist',
    schema_type: 'Article',
    structure_json: { sections: ['intro', 'checklist', 'faq', 'conclusion'], blocks: true },
    seo_rules_json: { intent: 'informational', og_type: 'article', primary_schema: 'Article' },
    quality_rules_json: { require_checklist: true },
  },
  {
    type_key: 'comparison_guide',
    display_name: 'Comparison Guide',
    prompt_key: 'type_comparison_guide',
    schema_type: 'Article',
    structure_json: { sections: ['intro', 'comparison', 'tables', 'faq', 'conclusion'], blocks: true },
    seo_rules_json: {
      intent: 'commercial_investigation',
      og_type: 'article',
      primary_schema: 'Article',
    },
    quality_rules_json: { require_comparison_table: true, require_related_compares: true },
  },
  {
    type_key: 'country_guide',
    display_name: 'Country Guide',
    prompt_key: 'type_country_guide',
    schema_type: 'Article',
    structure_json: { sections: ['intro', 'costs', 'cities', 'tips', 'faq', 'conclusion'], blocks: true },
    seo_rules_json: { intent: 'informational', og_type: 'article', primary_schema: 'Article' },
    quality_rules_json: { require_related_cities: true, require_country_hub_link: true },
  },
  {
    type_key: 'city_guide',
    display_name: 'City Guide',
    prompt_key: 'type_city_guide',
    schema_type: 'Article',
    structure_json: {
      sections: ['intro', 'costs', 'neighborhoods', 'tips', 'faq', 'conclusion'],
      blocks: true,
    },
    seo_rules_json: { intent: 'informational', og_type: 'article', primary_schema: 'Article' },
    quality_rules_json: { require_city_page_link: true },
  },
  {
    type_key: 'student_guide',
    display_name: 'Student Guide',
    prompt_key: 'type_student_guide',
    schema_type: 'Article',
    structure_json: { sections: ['intro', 'budget', 'housing', 'tips', 'faq', 'conclusion'], blocks: true },
    seo_rules_json: { intent: 'informational', og_type: 'article', primary_schema: 'Article' },
    quality_rules_json: { persona: 'student' },
  },
  {
    type_key: 'remote_worker_guide',
    display_name: 'Remote Worker Guide',
    prompt_key: 'type_remote_worker_guide',
    schema_type: 'Article',
    structure_json: {
      sections: ['intro', 'costs', 'connectivity', 'tips', 'faq', 'conclusion'],
      blocks: true,
    },
    seo_rules_json: { intent: 'informational', og_type: 'article', primary_schema: 'Article' },
    quality_rules_json: { persona: 'remote_worker' },
  },
  {
    type_key: 'retirement_guide',
    display_name: 'Retirement Guide',
    prompt_key: 'type_retirement_guide',
    schema_type: 'Article',
    structure_json: {
      sections: ['intro', 'costs', 'healthcare', 'tips', 'faq', 'conclusion'],
      blocks: true,
    },
    seo_rules_json: { intent: 'informational', og_type: 'article', primary_schema: 'Article' },
    quality_rules_json: { persona: 'retirement' },
  },
  {
    type_key: 'faq_hub',
    display_name: 'FAQ Hub',
    prompt_key: 'type_faq_hub',
    schema_type: 'FAQPage',
    structure_json: { sections: ['intro', 'faq_groups', 'conclusion'], blocks: true },
    seo_rules_json: { intent: 'informational', og_type: 'article', primary_schema: 'FAQPage' },
    quality_rules_json: { require_faq: true, min_faq: 8 },
  },
  {
    type_key: 'salary_guide',
    display_name: 'Salary Guide',
    prompt_key: 'type_guide',
    schema_type: 'Article',
    structure_json: { sections: ['intro', 'salaries', 'buying_power', 'faq', 'conclusion'], blocks: true },
    seo_rules_json: { intent: 'commercial_investigation', og_type: 'article', primary_schema: 'Article' },
    quality_rules_json: { require_faq: true },
  },
  {
    type_key: 'rent_guide',
    display_name: 'Rent Guide',
    prompt_key: 'type_guide',
    schema_type: 'Article',
    structure_json: { sections: ['intro', 'rent', 'neighborhoods', 'faq', 'conclusion'], blocks: true },
    seo_rules_json: { intent: 'commercial_investigation', og_type: 'article', primary_schema: 'Article' },
    quality_rules_json: { require_faq: true },
  },
  {
    type_key: 'food_guide',
    display_name: 'Food Guide',
    prompt_key: 'type_guide',
    schema_type: 'Article',
    structure_json: { sections: ['intro', 'groceries', 'dining', 'faq', 'conclusion'], blocks: true },
    seo_rules_json: { intent: 'informational', og_type: 'article', primary_schema: 'Article' },
    quality_rules_json: { require_faq: true },
  },
  {
    type_key: 'transportation_guide',
    display_name: 'Transportation Guide',
    prompt_key: 'type_guide',
    schema_type: 'Article',
    structure_json: { sections: ['intro', 'transit', 'costs', 'faq', 'conclusion'], blocks: true },
    seo_rules_json: { intent: 'informational', og_type: 'article', primary_schema: 'Article' },
    quality_rules_json: { require_faq: true },
  },
  {
    type_key: 'healthcare_guide',
    display_name: 'Healthcare Guide',
    prompt_key: 'type_guide',
    schema_type: 'Article',
    structure_json: { sections: ['intro', 'system', 'costs', 'faq', 'conclusion'], blocks: true },
    seo_rules_json: { intent: 'informational', og_type: 'article', primary_schema: 'Article' },
    quality_rules_json: { require_faq: true },
  },
  {
    type_key: 'tax_guide',
    display_name: 'Tax Guide',
    prompt_key: 'type_guide',
    schema_type: 'Article',
    structure_json: { sections: ['intro', 'taxes', 'expat_notes', 'faq', 'conclusion'], blocks: true },
    seo_rules_json: { intent: 'informational', og_type: 'article', primary_schema: 'Article' },
    quality_rules_json: { require_faq: true },
  },
  {
    type_key: 'visa_guide',
    display_name: 'Visa Guide',
    prompt_key: 'type_guide',
    schema_type: 'Article',
    structure_json: { sections: ['intro', 'visa_types', 'costs', 'faq', 'conclusion'], blocks: true },
    seo_rules_json: { intent: 'commercial_investigation', og_type: 'article', primary_schema: 'Article' },
    quality_rules_json: { require_faq: true },
  },
  {
    type_key: 'moving_guide',
    display_name: 'Moving Guide',
    prompt_key: 'type_guide',
    schema_type: 'Article',
    structure_json: { sections: ['intro', 'checklist', 'budget', 'faq', 'conclusion'], blocks: true },
    seo_rules_json: { intent: 'commercial_investigation', og_type: 'article', primary_schema: 'Article' },
    quality_rules_json: { require_checklist: true },
  },
  {
    type_key: 'budget_guide',
    display_name: 'Budget Guide',
    prompt_key: 'type_guide',
    schema_type: 'Article',
    structure_json: { sections: ['intro', 'budget', 'tips', 'faq', 'conclusion'], blocks: true },
    seo_rules_json: { intent: 'informational', og_type: 'article', primary_schema: 'Article' },
    quality_rules_json: { require_faq: true },
  },
];

/** Category stub prompts (expanded in later phases; seeded so Admin can edit early). */
export const CATEGORY_PROMPT_SEEDS: Array<{
  prompt_key: string;
  category: PromptCategory;
  title: string;
  body: string;
}> = [
  {
    prompt_key: 'master_system',
    category: 'Writer',
    title: 'Master Prompt',
    body: '', // filled from MASTER_SYSTEM_PROMPT in ensure — sole editable master in Editorial Control
  },
  {
    prompt_key: 'reviewer_system',
    category: 'Reviewer',
    title: 'Reviewer System Prompt',
    body: '',
  },
  {
    prompt_key: 'refresh_system',
    category: 'Refresh',
    title: 'Refresh Prompt',
    body: 'You update only dynamic cost-data blocks using supplied structured values. Never invent numbers. Never rewrite evergreen blocks, titles, slugs, introductions, or conclusions.',
  },
  {
    prompt_key: 'patch_system',
    category: 'Patch',
    title: 'Partial Patch Prompt',
    body: 'You rewrite only the listed dynamic paragraphs that contain data_keys. Keep tone consistent. Do not change title, slug, introduction, conclusion, or evergreen blocks.',
  },
  {
    prompt_key: 'seo_system',
    category: 'SEO',
    title: 'SEO Optimizer Prompt',
    body: 'Propose SEO title, meta title, meta description, and slug from the article draft and topic brief. Stay natural. Never keyword-stuff. Prefer clarity and click honesty.',
  },
  {
    prompt_key: 'outline_system',
    category: 'Outline',
    title: 'Outline Prompt',
    body: 'Create a practical evergreen outline with purposeful H2/H3 headings, FAQ candidates, and comparison-table opportunities using only the supplied structured data context.',
  },
  {
    prompt_key: 'summary_system',
    category: 'Summary',
    title: 'Summary Prompt',
    body: 'Write a concise excerpt and social summary that reflects the article accurately without hype, clickbait, or invented statistics.',
  },
];
