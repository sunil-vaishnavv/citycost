import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

export function TechnicalDetails({ raw, label = 'View Technical Details' }: { raw: string; label?: string }) {
  const [open, setOpen] = useState(false);
  let pretty = raw;
  try {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      pretty = JSON.stringify(JSON.parse(raw.slice(start, end + 1)), null, 2);
    }
  } catch {
    pretty = raw;
  }

  return (
    <div className="rounded-xl border border-slate-200/70 dark:border-white/10">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-white/[0.03]"
      >
        {label}
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <pre className="max-h-64 overflow-auto border-t border-slate-100 bg-slate-50/80 px-3.5 py-3 text-[11px] leading-relaxed text-slate-600 dark:border-white/10 dark:bg-black/30 dark:text-slate-400">
          {pretty}
        </pre>
      )}
    </div>
  );
}
