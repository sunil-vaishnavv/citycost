import { useEffect } from 'react';
import { CheckCircle2, Clock, X, XCircle } from 'lucide-react';
import { Badge, Button, Callout, Divider } from '../ui';
import { formatDuration, formatWhen } from './format';
import { extractErrorFromStageDetail, humanizeError } from './humanizeError';
import type { NormalizedStage } from './constants';
import { TechnicalDetails } from './TechnicalDetails';

function statusTone(status: NormalizedStage['status']) {
  if (status === 'ok') return 'emerald' as const;
  if (status === 'failed') return 'rose' as const;
  if (status === 'skipped') return 'neutral' as const;
  return 'amber' as const;
}

function statusIcon(status: NormalizedStage['status']) {
  if (status === 'ok') return <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />;
  if (status === 'failed') return <XCircle className="h-4 w-4 text-rose-600 dark:text-rose-400" />;
  return <Clock className="h-4 w-4 text-slate-400" />;
}

export function StageDrawer({
  stage,
  onClose,
}: {
  stage: NormalizedStage | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!stage) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stage, onClose]);

  if (!stage) return null;

  const errRaw = stage.status === 'failed' ? extractErrorFromStageDetail(stage.detail) : null;
  const human = errRaw ? humanizeError(errRaw) : null;
  const cleanDetail =
    stage.detail && !human
      ? stage.detail
      : stage.detail && human && !stage.detail.trim().startsWith('{')
        ? stage.detail.split('{')[0]?.trim() || null
        : null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close drawer"
        className="absolute inset-0 bg-slate-900/30 backdrop-blur-[2px] transition-opacity"
        onClick={onClose}
      />
      <aside className="relative z-10 flex h-full w-full max-w-md flex-col border-l border-slate-200/80 bg-white shadow-2xl dark:border-white/10 dark:bg-slate-950">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-white/10">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Stage detail</p>
            <h3 className="mt-1 font-display text-lg font-bold text-slate-900 dark:text-white">{stage.label}</h3>
          </div>
          <Button size="sm" variant="ghost" icon={<X className="h-4 w-4" />} onClick={onClose} aria-label="Close" />
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-slate-50 dark:bg-white/5">
              {statusIcon(stage.status)}
            </span>
            <div>
              <Badge tone={statusTone(stage.status)} dot>
                {stage.status === 'pending' ? 'Not started' : stage.status}
              </Badge>
              <p className="mt-1 text-xs text-slate-500">{formatWhen(stage.at || null)}</p>
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl bg-slate-50/80 px-3 py-2.5 dark:bg-white/[0.03]">
              <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Duration</dt>
              <dd className="mt-1 font-semibold text-slate-800 dark:text-slate-100">
                {formatDuration(stage.duration_ms)}
              </dd>
            </div>
            <div className="rounded-xl bg-slate-50/80 px-3 py-2.5 dark:bg-white/[0.03]">
              <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Provider</dt>
              <dd className="mt-1 font-semibold text-slate-800 dark:text-slate-100">{human?.provider || '—'}</dd>
            </div>
            <div className="rounded-xl bg-slate-50/80 px-3 py-2.5 dark:bg-white/[0.03]">
              <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Model</dt>
              <dd className="mt-1 truncate font-semibold text-slate-800 dark:text-slate-100">{human?.model || '—'}</dd>
            </div>
            <div className="rounded-xl bg-slate-50/80 px-3 py-2.5 dark:bg-white/[0.03]">
              <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Code</dt>
              <dd className="mt-1 truncate font-semibold text-slate-800 dark:text-slate-100">{human?.code || '—'}</dd>
            </div>
          </dl>

          {cleanDetail && (
            <div>
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">Output</p>
              <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-200">{cleanDetail}</p>
            </div>
          )}

          {human && (
            <>
              <Divider />
              <Callout tone="rose">
                <p className="font-semibold">{human.title}</p>
                <p className="mt-1 text-xs opacity-90">{human.reason}</p>
              </Callout>
              <TechnicalDetails raw={human.raw} />
            </>
          )}

          {stage.status === 'pending' && (
            <p className="text-sm text-slate-500">This stage has not run yet for today’s pipeline.</p>
          )}
        </div>
      </aside>
    </div>
  );
}
