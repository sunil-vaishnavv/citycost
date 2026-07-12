/**
 * Backward-compatible façade — delegates to the production COL engine.
 * Prefer importing from `./col-engine/index.js` for new code.
 */

import {
  resolveCityCostOfLivingSync,
  type ColEngineResult,
} from './col-engine/index.js';

export type { ColEngineResult };

/** @deprecated Use resolveCityCostOfLiving / resolveCityCostOfLivingSync */
export function estimateCityCost(query: string): ColEngineResult {
  return resolveCityCostOfLivingSync(query);
}

export { resolveCityCostOfLiving, resolveCityCostOfLivingSync } from './col-engine/index.js';
