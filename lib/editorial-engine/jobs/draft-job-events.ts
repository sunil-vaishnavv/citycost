/**
 * In-process fan-out for SSE subscribers watching draft_generate jobs.
 */

import { EventEmitter } from 'node:events';
import type { DraftJobProgress } from './draft-job-types.js';

const bus = new EventEmitter();
bus.setMaxListeners(100);

export type DraftJobEventPayload = {
  jobId: number;
  status: string;
  progress: DraftJobProgress;
  error_message?: string | null;
};

export function emitDraftJobUpdate(payload: DraftJobEventPayload): void {
  bus.emit(`job:${payload.jobId}`, payload);
  bus.emit('job:*', payload);
}

export function subscribeDraftJob(
  jobId: number,
  listener: (payload: DraftJobEventPayload) => void
): () => void {
  const key = `job:${jobId}`;
  bus.on(key, listener);
  return () => {
    bus.off(key, listener);
  };
}

export function subscribeAllDraftJobs(
  listener: (payload: DraftJobEventPayload) => void
): () => void {
  bus.on('job:*', listener);
  return () => {
    bus.off('job:*', listener);
  };
}
