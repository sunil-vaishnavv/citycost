import type { DraftJobLogEntry } from './types';

export function JobLogs({ logs }: { logs: DraftJobLogEntry[] }) {
  if (!logs?.length) {
    return <p className="text-xs text-slate-500">No logs yet.</p>;
  }
  return (
    <ul className="max-h-56 space-y-1.5 overflow-y-auto rounded-lg border border-slate-200/80 bg-slate-50/80 p-3 font-mono text-[11px] leading-relaxed dark:border-white/10 dark:bg-slate-950/50">
      {logs.map((log, i) => (
        <li
          key={`${log.t}-${i}`}
          className={
            log.level === 'error'
              ? 'text-rose-600 dark:text-rose-400'
              : log.level === 'warn'
                ? 'text-amber-700 dark:text-amber-400'
                : 'text-slate-600 dark:text-slate-300'
          }
        >
          <span className="text-slate-400 dark:text-slate-500">
            {new Date(log.t).toLocaleTimeString()}
          </span>{' '}
          {log.message}
        </li>
      ))}
    </ul>
  );
}
