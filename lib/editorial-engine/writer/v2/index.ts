/**
 * Writer Engine v2 public exports.
 */

export { buildEditorialPlan } from './editorial-brain.js';
export { routeGuideId, GUIDE_LABELS } from './guide-router.js';
export { detectPersona, listPersonas } from './persona/engine.js';
export { selectStyle, getStyle } from './style/library.js';
export { generateDynamicOutline } from './outlines/dynamic-outline-generator.js';
export { getGuideSectionWriter, listGuideSectionWriterIds } from './sections/registry.js';
export { runWriterV2 } from './orchestrator.js';
export {
  ensureDraftIntegrity,
  inspectDraftIntegrity,
  mergeWithProtected,
  snapshotProtected,
  splitProtectedBlocks,
  mintBlockId,
  type DraftIntegrityReport,
  type ProtectedSnapshot,
} from './block-integrity.js';
export { runSimilarityEngine } from './similarity/engine.js';
export { loadPublishedMemory } from './similarity/memory.js';
export { runQualityAudit } from './quality-audit.js';
export {
  runContentQualityEngine,
  formatQualityDebug,
} from './content-quality/index.js';
export {
  runHelpfulnessPipeline,
  formatHelpfulnessDebug,
} from './helpfulness-pipeline.js';
export { applyRealWorldExamples } from './example-engine.js';
export { applyNaturalLinks, slugToNaturalLabel, runInternalLinkEngine } from './link-engine.js';
export { applyDecisionSupport } from './decision-support-engine.js';
export { applyHelpfulContent, scoreHelpfulDraft } from './helpful-content.js';
export {
  applyActionableValueBlocks,
  validateActionableValue,
  GUIDE_VALUE_BLOCK_REGISTRY,
} from './actionable-value-blocks.js';
export {
  createContentMemory,
  rememberSection,
  applyContentMemoryPass,
  buildMemoryFromDraft,
} from './content-memory.js';
export {
  checkCrossSectionSimilarity,
  formatCrossSectionDebug,
} from './cross-section-similarity.js';
export {
  runFinalSanitizer,
  formatFinalSanitizerDebug,
  validateSentenceIntegrity,
  validateParagraphIntegrity,
  validateNumericSanity,
  validateFormatting,
} from './final-sanitizer.js';
export {
  runPreSaveQualityGates,
  formatQualityGatesDebug,
} from './quality-gates.js';
export {
  humanizeDeterministic,
  humanizeDeterministicWithReport,
  detectHumanWritingIssues,
} from './humanization.js';
export {
  AI_PHRASE_BLACKLIST,
  applyAiPhraseBlacklist,
  detectAiPhrases,
} from './ai-phrase-blacklist.js';
export type * from './types.js';
