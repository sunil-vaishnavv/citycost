/**
 * CityCost AI Editorial Engine — public exports.
 * P0–P7: strategy → calendar → writer → reviewer → SEO → publish + daily automation.
 */

export { EDITORIAL_ENGINE_VERSION, EDITORIAL_PHASE, PROMPT_CATEGORIES, TOPIC_STATUSES } from './constants.js';
export { initEditorialEngine, getEditorialRuntime } from './init.js';
export { createEditorialRouter } from './routes.js';
export { getEditorialHealth } from './health.js';
export { runEditorialStrategy } from './strategy/strategy-engine.js';
export { detectContentGaps } from './strategy/content-gaps.js';
export { generateArticleDraft, previewTopicResearch } from './writer/generate.js';
export {
  regenerateArticleFaq,
  generateDedicatedFaqs,
  validateFaqItems,
  FAQ_SYSTEM_PROMPT,
} from './faq/index.js';
export {
  buildResearchPack,
  previewResearchPack,
  validateResearchPack,
  ResearchPackValidationError,
  RESEARCH_PACK_VERSION,
} from './research/index.js';
export type { ResearchPack } from './research/index.js';
export { reviewArticle, getArticleReviewHistory } from './reviewer/review.js';
export { generateArticleSeo, getArticlePreview } from './seo/generate-seo.js';
export { publishArticle, unpublishArticle } from './publish/publish.js';
export { getPublishReadiness } from './publish/publish-gate.js';
export { insertGenerationLog } from './db/generation-logs-repo.js';
export type {
  EditorialHealth,
  EditorialSettings,
  EditorialDashboard,
  PromptTemplate,
  PromptCategory,
  ContentTypeRow,
  EditorialTopic,
  EditorialCluster,
  EditorialCalendarEntry,
  ContentGap,
  TopicStatus,
  QueuePort,
  SchedulerPort,
  AiProviderPort,
  StoragePort,
} from './types.js';
