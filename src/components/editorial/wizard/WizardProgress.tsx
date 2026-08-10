import { Check, Lock } from 'lucide-react';
import type { ProgressStep } from '../article-workflow';

/**
 * 6-step progress bar. Only the current (active) step is clickable.
 * Done = green, current = blue, locked = gray + lock.
 */
export default function WizardProgress({
  steps,
  onSelectCurrent,
}: {
  steps: ProgressStep[];
  onSelectCurrent?: (step: ProgressStep) => void;
}) {
  return (
    <nav aria-label="Article workflow progress" className="flex items-center overflow-x-auto pb-1">
      {steps.map((step, i) => {
        const clickable = step.status === 'current' && Boolean(onSelectCurrent);
        return (
          <div key={step.key} className="flex shrink-0 items-center">
            <button
              type="button"
              disabled={!clickable}
              onClick={() => clickable && onSelectCurrent?.(step)}
              className={`flex flex-col items-center gap-1.5 ${
                clickable ? 'cursor-pointer' : 'cursor-default'
              }`}
              title={
                step.status === 'current'
                  ? `Current: ${step.label}`
                  : step.status === 'done'
                    ? `${step.label} complete — open Advanced to inspect`
                    : `${step.label} locked`
              }
              aria-current={step.status === 'current' ? 'step' : undefined}
            >
              <div
                className={`grid h-8 w-8 place-items-center rounded-full text-[11px] font-bold transition-colors ${
                  step.status === 'done'
                    ? 'bg-emerald-500 text-white'
                    : step.status === 'current'
                      ? 'bg-sky-600 text-white ring-4 ring-sky-100 dark:ring-sky-500/25'
                      : 'bg-slate-100 text-slate-400 dark:bg-white/5 dark:text-slate-600'
                }`}
              >
                {step.status === 'done' ? (
                  <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                ) : step.status === 'locked' ? (
                  <Lock className="h-3 w-3" />
                ) : (
                  <span>{i + 1}</span>
                )}
              </div>
              <span
                className={`max-w-[4.5rem] truncate text-center text-[10px] font-semibold sm:max-w-none ${
                  step.status === 'locked'
                    ? 'text-slate-400 dark:text-slate-600'
                    : step.status === 'current'
                      ? 'text-sky-700 dark:text-sky-300'
                      : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                <span className="mr-0.5 hidden sm:inline" aria-hidden>
                  {step.emoji}
                </span>
                {step.label}
              </span>
            </button>
            {i < steps.length - 1 && (
              <div
                className={`mx-1 mb-5 h-0.5 w-6 rounded-full sm:mx-1.5 sm:w-10 ${
                  step.status === 'done' ? 'bg-emerald-400' : 'bg-slate-200 dark:bg-white/10'
                }`}
              />
            )}
          </div>
        );
      })}
    </nav>
  );
}
