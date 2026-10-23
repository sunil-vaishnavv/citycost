/**
 * Lightweight process-memory diagnostics for background editorial jobs.
 * Logs numbers only — never prompts, research, or article content.
 */

export interface MemorySample {
  heap_used_mb: number;
  rss_mb: number;
}

const MB = 1024 * 1024;

export function sampleMemory(): MemorySample {
  const m = process.memoryUsage();
  return {
    heap_used_mb: Math.round((m.heapUsed / MB) * 10) / 10,
    rss_mb: Math.round((m.rss / MB) * 10) / 10,
  };
}

/** Tracks peak heap across a job and emits one log line per stage change. */
export function createJobMemoryTracker(label: string) {
  const start = sampleMemory();
  let peak = start.heap_used_mb;
  let lastStage = '';
  return {
    start,
    stage(stage: string): MemorySample {
      const s = sampleMemory();
      if (s.heap_used_mb > peak) peak = s.heap_used_mb;
      if (stage !== lastStage) {
        lastStage = stage;
        console.log(`[${label}] stage=${stage} heap=${s.heap_used_mb}MB rss=${s.rss_mb}MB`);
      }
      return s;
    },
    finish(outcome: string): { peak_heap_mb: number; heap_delta_mb: number } {
      const s = sampleMemory();
      if (s.heap_used_mb > peak) peak = s.heap_used_mb;
      const heap_delta_mb = Math.round((s.heap_used_mb - start.heap_used_mb) * 10) / 10;
      console.log(
        `[${label}] ${outcome} heap=${s.heap_used_mb}MB (Δ${heap_delta_mb}MB, peak ${peak}MB) rss=${s.rss_mb}MB`
      );
      return { peak_heap_mb: peak, heap_delta_mb };
    },
  };
}
