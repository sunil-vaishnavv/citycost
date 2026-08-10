import type { QueuePort } from '../types.js';

/**
 * DB-backed queue adapter (swap-ready for Redis later).
 * Claim/complete/fail live in jobs-repo; used by the daily pipeline.
 */
export function createDbQueue(): QueuePort {
  return {
    async enqueue(jobType, payload, runAfter) {
      const { insertJob } = await import('../db/jobs-repo.js');
      return insertJob(jobType, payload ?? {}, runAfter ?? null);
    },

    async getJob(id) {
      const { getJobById } = await import('../db/jobs-repo.js');
      return getJobById(id);
    },
  };
}
