/**
 * Research Engine entry (compat re-export).
 * Implementation lives in ../research — Writer consumes ResearchPack only.
 */

export {
  RESEARCH_PACK_VERSION,
  ResearchPackValidationError,
  assembleResearchPack,
  buildResearchPack,
  buildGroundedResearchPackAsync,
  previewResearchPack,
  validateResearchPack,
} from '../research/index.js';

export type {
  OutlineSection,
  ResearchEntities,
  ResearchKeywords,
  ResearchLinkRef,
  ResearchPack,
  ResearchPackValidation,
  WriterResearchContract,
} from '../research/index.js';
