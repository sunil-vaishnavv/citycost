import type { SchedulerPort } from '../types.js';

const TICK_MS = 30_000;

/**
 * In-process scheduler adapter.
 * P7: minute-level tick for registered handlers (daily_generate).
 */
export function createInProcessScheduler(): SchedulerPort {
  const handlers = new Map<string, { cronOrInterval: string; handler: () => Promise<void> }>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let ticking = false;

  async function tickAll(): Promise<void> {
    if (ticking) return;
    ticking = true;
    try {
      for (const [name, entry] of handlers) {
        try {
          await entry.handler();
        } catch (err) {
          console.warn(`⚠️  Editorial scheduler '${name}' tick failed:`, (err as Error).message);
        }
      }
    } finally {
      ticking = false;
    }
  }

  return {
    register(name, cronOrInterval, handler) {
      handlers.set(name, { cronOrInterval, handler });
    },
    start() {
      if (timer) return;
      timer = setInterval(() => {
        void tickAll();
      }, TICK_MS);
      // Unref so the timer does not keep the process alive in tests/scripts
      if (typeof timer === 'object' && timer && 'unref' in timer) {
        (timer as NodeJS.Timeout).unref?.();
      }
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      handlers.clear();
    },
    listRegistered() {
      return [...handlers.keys()];
    },
  };
}
