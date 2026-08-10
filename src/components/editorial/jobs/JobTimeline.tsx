import { Check, X } from 'lucide-react';
import type { DraftJobStageState, DraftJobStageStatus } from './types';

/** Curved hook branching off the vertical spine (pending / skipped). */
function TimelineHook({ className }: { className?: string }) {
  return (
    <svg
      width="14"
      height="16"
      viewBox="0 0 14 16"
      fill="none"
      aria-hidden
      className={className}
    >
      <path
        d="M7 0v7.5c0 2.2 1.8 4 4 4H13"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function stageTextClass(status: DraftJobStageStatus): string {
  switch (status) {
    case 'done':
      return 'text-emerald-700 dark:text-emerald-400';
    case 'active':
      return 'text-teal-800 dark:text-teal-300';
    case 'failed':
      return 'text-rose-600 dark:text-rose-400';
    default:
      return 'text-slate-400 dark:text-slate-500';
  }
}

function StageNode({ status }: { status: DraftJobStageStatus }) {
  if (status === 'done') {
    return (
      <span
        className="relative z-10 flex h-4 w-4 items-center justify-center rounded-full border-2 border-emerald-600 bg-emerald-600 text-white dark:border-emerald-500 dark:bg-emerald-500"
        aria-hidden
      >
        <Check className="h-2.5 w-2.5" strokeWidth={3} />
      </span>
    );
  }

  if (status === 'active') {
    return (
      <span className="relative z-10 flex h-4 w-4 items-center justify-center" aria-hidden>
        <span className="absolute inset-0 rounded-full bg-teal-500/35 animate-ping dark:bg-teal-400/30" />
        <span className="relative h-3 w-3 rounded-full bg-teal-600 ring-2 ring-teal-400/60 dark:bg-teal-400 dark:ring-teal-300/40" />
      </span>
    );
  }

  if (status === 'failed') {
    return (
      <span
        className="relative z-10 flex h-4 w-4 items-center justify-center rounded-full border-2 border-rose-500 bg-rose-500 text-white dark:border-rose-400 dark:bg-rose-400"
        aria-hidden
      >
        <X className="h-2.5 w-2.5" strokeWidth={3} />
      </span>
    );
  }

  // pending | skipped — muted hook off the spine
  return <TimelineHook className="relative z-10 text-slate-300 dark:text-slate-600" />;
}

export function JobTimeline({
  stages,
  sectionDetail,
}: {
  stages: DraftJobStageState[];
  sectionDetail?: string;
}) {
  if (!stages?.length) {
    return <p className="text-sm text-slate-500">Waiting for pipeline stages…</p>;
  }

  return (
    <ol className="relative list-none py-0.5">
      {/* Continuous vertical spine */}
      <span
        className="pointer-events-none absolute bottom-3 left-[7px] top-3 w-px bg-slate-200 dark:bg-white/10"
        aria-hidden
      />

      {stages.map((stage) => {
        const active = stage.status === 'active';
        const pendingLike = stage.status === 'pending' || stage.status === 'skipped';

        return (
          <li
            key={stage.id}
            className={`relative flex items-start gap-3 py-1.5 text-sm ${stageTextClass(stage.status)}`}
          >
            <span
              className={`flex w-4 shrink-0 justify-center ${pendingLike ? '' : 'pt-0.5'}`}
            >
              <StageNode status={stage.status} />
            </span>

            <span className="min-w-0 flex-1 pt-px">
              <span
                className={`font-medium leading-snug ${
                  active ? 'animate-pulse' : stage.status === 'done' ? 'font-semibold' : ''
                }`}
              >
                {stage.label}
              </span>
              {active && sectionDetail && stage.id === 'writing_sections' && (
                <span className="mt-0.5 block text-xs font-normal text-slate-500 dark:text-slate-400">
                  {sectionDetail}
                </span>
              )}
              {stage.detail && (
                <span className="mt-0.5 block text-xs font-normal opacity-80">{stage.detail}</span>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
