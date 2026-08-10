export { reviseDraftOnce } from './revision-engine.js';
export { runRevisionLoop, autoFixArticle } from './revision-service.js';
export { listRevisionHistory, getRevisionStats, insertRevisionHistory } from './revision-history.js';
export { buildRevisionBatchPlan } from './revision-plan.js';
export {
  REVISION_ENGINE_VERSION,
  REVISION_PROMPT_VERSION,
  type RevisionLoopResult,
  type RevisionHistoryRow,
  type RevisionResult,
  type RevisionProgressEvent,
  type RevisionProgressStage,
} from './revision-types.js';
export type {
  RevisionBatchPlan,
  IssueSummaryItem,
  WordBudget,
} from './revision-plan.js';
export { buildIssuePlan } from '../validation/issue-plan.js';
export { runSharedDeterministicChecks } from '../validation/shared-checks.js';
