/**
 * CityCost Editorial — shared design system primitives.
 * Premium, restrained visual language: slate neutrals + teal/indigo accents,
 * glass surfaces, soft depth, and calm motion. Dark mode via `.dark` ancestor.
 */
import {
  forwardRef,
  useState,
  type ButtonHTMLAttributes,
  type ComponentType,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type Key,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { Loader2 } from 'lucide-react';

export type Tone = 'neutral' | 'emerald' | 'amber' | 'rose' | 'sky' | 'indigo' | 'teal';

const TONE_CLASSES: Record<Tone, string> = {
  neutral:
    'bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300 ring-1 ring-inset ring-slate-200 dark:ring-white/10',
  emerald:
    'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300 ring-1 ring-inset ring-emerald-200 dark:ring-emerald-500/20',
  amber:
    'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300 ring-1 ring-inset ring-amber-200 dark:ring-amber-500/20',
  rose: 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300 ring-1 ring-inset ring-rose-200 dark:ring-rose-500/20',
  sky: 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300 ring-1 ring-inset ring-sky-200 dark:ring-sky-500/20',
  indigo:
    'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300 ring-1 ring-inset ring-indigo-200 dark:ring-indigo-500/20',
  teal: 'bg-teal-50 text-teal-700 dark:bg-teal-500/10 dark:text-teal-300 ring-1 ring-inset ring-teal-200 dark:ring-teal-500/20',
};

const DOT_CLASSES: Record<Tone, string> = {
  neutral: 'bg-slate-400',
  emerald: 'bg-emerald-500',
  amber: 'bg-amber-500',
  rose: 'bg-rose-500',
  sky: 'bg-sky-500',
  indigo: 'bg-indigo-500',
  teal: 'bg-teal-500',
};

export function Badge({
  tone = 'neutral',
  children,
  dot = false,
  className = '',
}: {
  key?: Key;
  tone?: Tone;
  children: ReactNode;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap ${TONE_CLASSES[tone]} ${className}`}
    >
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${DOT_CLASSES[tone]}`} />}
      {children}
    </span>
  );
}

const STATUS_MAP: Record<string, { tone: Tone; label: string }> = {
  candidate: { tone: 'neutral', label: 'Candidate' },
  approved: { tone: 'sky', label: 'Approved' },
  scheduled: { tone: 'indigo', label: 'Scheduled' },
  generating: { tone: 'amber', label: 'Generating' },
  draft: { tone: 'amber', label: 'Draft' },
  review: { tone: 'sky', label: 'In Review' },
  published: { tone: 'emerald', label: 'Published' },
  archived: { tone: 'neutral', label: 'Archived' },
  rejected: { tone: 'rose', label: 'Rejected' },
  failed: { tone: 'rose', label: 'Failed' },
  needs_manual_review: { tone: 'amber', label: 'Needs Manual Review' },
  queued: { tone: 'neutral', label: 'Queued' },
  running: { tone: 'amber', label: 'Running' },
  completed: { tone: 'emerald', label: 'Completed' },
  skipped: { tone: 'neutral', label: 'Skipped' },
  ok: { tone: 'emerald', label: 'OK' },
  cancelled: { tone: 'neutral', label: 'Cancelled' },
};

const STATUS_EMPHASIS_CLASSES: Partial<Record<string, string>> = {
  published:
    '!bg-emerald-100 !text-emerald-800 !ring-emerald-300/80 dark:!bg-emerald-500/20 dark:!text-emerald-200 dark:!ring-emerald-400/40 font-bold shadow-sm shadow-emerald-500/10',
  needs_manual_review:
    '!bg-orange-50 !text-orange-800 !ring-orange-200 dark:!bg-orange-500/15 dark:!text-orange-200 dark:!ring-orange-500/30 font-semibold',
  failed:
    '!bg-rose-100 !text-rose-800 !ring-rose-200 dark:!bg-rose-500/15 dark:!text-rose-200 dark:!ring-rose-500/30 font-semibold',
};

/** Left-border + subtle tint for article cards keyed by pipeline status. */
export function articleStatusCardClass(status: string): string {
  switch (status) {
    case 'published':
      return 'border-l-[3px] border-l-emerald-500 bg-emerald-50/40 dark:bg-emerald-500/[0.06] dark:border-l-emerald-400';
    case 'review':
      return 'border-l-[3px] border-l-sky-400 bg-sky-50/30 dark:bg-sky-500/[0.05] dark:border-l-sky-400';
    case 'needs_manual_review':
      return 'border-l-[3px] border-l-orange-400 bg-orange-50/35 dark:bg-orange-500/[0.06] dark:border-l-orange-400';
    case 'draft':
      return 'border-l-[3px] border-l-amber-400 bg-amber-50/25 dark:bg-amber-500/[0.04] dark:border-l-amber-400';
    case 'failed':
      return 'border-l-[3px] border-l-rose-400 bg-rose-50/30 dark:bg-rose-500/[0.05] dark:border-l-rose-400';
    case 'archived':
      return 'border-l-[3px] border-l-slate-300 bg-slate-50/50 dark:bg-white/[0.02] dark:border-l-slate-600';
    default:
      return 'border-l-[3px] border-l-slate-200 dark:border-l-slate-700';
  }
}

export function StatusPill({
  status,
  emphasis = false,
}: {
  status: string;
  emphasis?: boolean;
}) {
  const meta = STATUS_MAP[status] || { tone: 'neutral' as Tone, label: status.replace(/_/g, ' ') };
  const extra = emphasis ? STATUS_EMPHASIS_CLASSES[status] || '' : '';
  return (
    <Badge tone={meta.tone} dot className={extra}>
      {meta.label}
    </Badge>
  );
}

export function Card({
  children,
  className = '',
  padding = 'p-5',
}: {
  key?: Key;
  children: ReactNode;
  className?: string;
  padding?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-slate-200/80 bg-white dark:border-white/10 dark:bg-slate-900/60 ${padding} ${className}`}
    >
      {children}
    </div>
  );
}

export function GlassPanel({
  children,
  className = '',
  padding = 'p-5',
  hover = false,
  onClick,
  role,
  tabIndex,
  onKeyDown,
}: {
  key?: Key;
  children: ReactNode;
  className?: string;
  padding?: string;
  hover?: boolean;
  onClick?: () => void;
  role?: string;
  tabIndex?: number;
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      role={role}
      tabIndex={tabIndex}
      onClick={onClick}
      onKeyDown={onKeyDown}
      className={`rounded-2xl border border-slate-200/70 bg-white/80 backdrop-blur-xl shadow-sm shadow-slate-200/60 dark:border-white/10 dark:bg-slate-900/50 dark:shadow-none ${
        hover
          ? 'transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-slate-200/60 dark:hover:shadow-black/20'
          : ''
      } ${padding} ${className}`}
    >
      {children}
    </div>
  );
}

export function SectionHeader({
  eyebrow,
  title,
  description,
  actions,
  className = '',
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap items-start justify-between gap-3 ${className}`}>
      <div>
        {eyebrow && (
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-teal-700 dark:text-teal-400">
            {eyebrow}
          </p>
        )}
        <h2 className="mt-1 font-display text-xl font-bold tracking-tight text-slate-900 dark:text-white">
          {title}
        </h2>
        {description && (
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function MetricCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = 'neutral',
  onClick,
  active = false,
}: {
  key?: Key;
  icon?: ComponentType<{ className?: string }>;
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: Tone;
  onClick?: () => void;
  active?: boolean;
}) {
  const interactive = typeof onClick === 'function';
  const ring = active
    ? 'ring-2 ring-teal-500/70 dark:ring-teal-400/60'
    : interactive
      ? 'ring-1 ring-transparent hover:ring-slate-300/80 dark:hover:ring-white/15'
      : '';

  return (
    <GlassPanel
      hover={interactive || !active}
      padding="p-4 sm:p-5"
      className={`${ring} ${interactive ? 'cursor-pointer' : ''}`}
      onClick={onClick}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {label}
          </p>
          <p className="mt-1.5 truncate font-display text-2xl font-bold text-slate-900 dark:text-white">
            {value}
          </p>
          {hint && <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">{hint}</p>}
        </div>
        {Icon && (
          <span
            className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${TONE_CLASSES[tone]}`}
          >
            <Icon className="h-4.5 w-4.5" />
          </span>
        )}
      </div>
    </GlassPanel>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-6 py-14 text-center dark:border-white/10 dark:bg-white/[0.02]">
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-white/5 dark:text-slate-500">
        <Icon className="h-5 w-5" />
      </span>
      <div>
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</p>
        {description && (
          <p className="mt-1 max-w-sm text-xs text-slate-500 dark:text-slate-400">
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}

export function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return <Loader2 className={`animate-spin ${className}`} />;
}

export function PageLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500 dark:text-slate-400">
      <Spinner /> {label}
    </div>
  );
}

export function Skeleton({ className = '' }: { key?: Key; className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-lg bg-slate-200/70 dark:bg-white/5 ${className}`}
    />
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled = false,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
}) {
  const switchEl = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 disabled:opacity-50 ${
        checked ? 'bg-teal-600' : 'bg-slate-300 dark:bg-white/15'
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ${
          checked ? 'translate-x-5' : ''
        }`}
      />
    </button>
  );

  if (!label) return switchEl;

  return (
    <label className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-white/10 dark:bg-white/[0.03]">
      <span>
        <span className="block text-sm font-medium text-slate-700 dark:text-slate-200">
          {label}
        </span>
        {description && (
          <span className="mt-0.5 block text-xs text-slate-400 dark:text-slate-500">
            {description}
          </span>
        )}
      </span>
      {switchEl}
    </label>
  );
}

const BUTTON_VARIANTS = {
  primary:
    'bg-slate-900 text-white hover:bg-slate-800 dark:bg-teal-600 dark:hover:bg-teal-500 disabled:hover:bg-slate-900 dark:disabled:hover:bg-teal-600',
  accent: 'bg-teal-600 text-white hover:bg-teal-500 disabled:hover:bg-teal-600',
  secondary:
    'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-white/10 dark:text-slate-200 dark:hover:bg-white/15',
  outline:
    'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-white/15 dark:bg-transparent dark:text-slate-200 dark:hover:bg-white/5',
  ghost:
    'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10',
  danger:
    'border border-rose-200 bg-white text-rose-600 hover:bg-rose-50 dark:border-rose-500/30 dark:bg-transparent dark:text-rose-400 dark:hover:bg-rose-500/10',
} as const;

const BUTTON_SIZES = {
  sm: 'px-3 py-1.5 text-xs gap-1.5',
  md: 'px-4 py-2.5 text-sm gap-2',
  lg: 'px-5 py-3 text-sm gap-2',
} as const;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof BUTTON_VARIANTS;
  size?: keyof typeof BUTTON_SIZES;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, icon, className = '', children, disabled, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={rest.type || 'button'}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center rounded-xl font-semibold transition-all duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${BUTTON_VARIANTS[variant]} ${BUTTON_SIZES[size]} ${className}`}
      {...rest}
    >
      {loading ? <Spinner className="h-3.5 w-3.5" /> : icon}
      {children}
    </button>
  );
});

const fieldBase =
  'w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-teal-500';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className = '', ...rest }, ref) {
    return <input ref={ref} className={`${fieldBase} ${className}`} {...rest} />;
  }
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className = '', ...rest }, ref) {
  return <textarea ref={ref} className={`${fieldBase} ${className}`} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className = '', children, ...rest }, ref) {
    return (
      <select
        ref={ref}
        className={`${fieldBase} appearance-none dark:[color-scheme:dark] ${className}`}
        {...rest}
      >
        {children}
      </select>
    );
  }
);

export function Field({
  label,
  hint,
  children,
  className = '',
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block text-sm ${className}`}>
      <span className="mb-1.5 block font-medium text-slate-700 dark:text-slate-200">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400 dark:text-slate-500">{hint}</span>}
    </label>
  );
}

export function Tabs({
  items,
  active,
  onChange,
  className = '',
}: {
  items: Array<{ key: string; label: string; icon?: ReactNode }>;
  active: string;
  onChange: (key: string) => void;
  className?: string;
}) {
  return (
    <div
      className={`flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-white/10 ${className}`}
    >
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          onClick={() => onChange(item.key)}
          className={`relative flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3.5 py-2.5 text-xs font-semibold transition-colors ${
            active === item.key
              ? 'text-slate-900 dark:text-white'
              : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
          }`}
        >
          {item.icon}
          {item.label}
          {active === item.key && (
            <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-teal-600 dark:bg-teal-400" />
          )}
        </button>
      ))}
    </div>
  );
}

export function Divider({ className = '' }: { className?: string }) {
  return <div className={`h-px w-full bg-slate-200 dark:bg-white/10 ${className}`} />;
}

export function KeyValue({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <span className="font-medium text-slate-800 dark:text-slate-100 text-right">{value}</span>
    </div>
  );
}

export function ScoreBar({
  label,
  value,
}: {
  key?: Key;
  label: string;
  value: number | null | undefined;
}) {
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value));
  const tone = value == null ? 'bg-slate-300 dark:bg-white/10' : pct >= 80 ? 'bg-emerald-500' : pct >= 60 ? 'bg-amber-500' : 'bg-rose-500';
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-slate-500 dark:text-slate-400">{label}</span>
        <span className="font-semibold text-slate-800 dark:text-slate-100">
          {value == null ? '—' : value}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-white/5">
        <div className={`h-full rounded-full transition-all duration-500 ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function Callout({
  tone = 'neutral',
  children,
  className = '',
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-xl px-4 py-3 text-sm ${TONE_CLASSES[tone]} ${className}`}>
      {children}
    </div>
  );
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel = 'Confirm',
  danger = false,
  busy = false,
  typedConfirm,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  /** When set, user must type this exact string to enable confirm (e.g. published article slug). */
  typedConfirm?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = useState('');
  const needsType = Boolean(typedConfirm);
  const typeOk = !needsType || typed.trim() === typedConfirm;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
      <div className="editorial-fade-in w-full max-w-md space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-white/10 dark:bg-slate-900">
        <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">{title}</h3>
        <div className="text-sm text-slate-600 dark:text-slate-300">{body}</div>
        {needsType && (
          <Field label={`Type "${typedConfirm}" to confirm`}>
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={typedConfirm}
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
        )}
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            className="flex-1"
            loading={busy}
            disabled={!typeOk}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
