import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

type ContentCardProps = {
  children: ReactNode;
  className?: string;
  padded?: boolean;
};

/** Shared width + premium chrome matching BlogArticlePage */
export const CONTENT_PAGE_WIDTH = 'mx-auto w-full max-w-5xl space-y-8 animate-in fade-in duration-300 xl:max-w-6xl';

/** Site-wide type scale for chips / secondary nav (keep consistent). */
export const CONTENT_CHIP_CLASS =
  'inline-flex max-w-full items-center rounded-full border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold leading-snug text-slate-700 transition hover:border-teal-300 hover:bg-teal-50 hover:text-teal-800 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:border-teal-500/40 dark:hover:bg-teal-500/10 dark:hover:text-teal-200';

export function ContentNavLink({
  href,
  onNavigate,
  children,
  className = '',
}: {
  href: string;
  onNavigate: (path: string) => void;
  children: ReactNode;
  className?: string;
}) {
  const safe = href.trim() || '/';
  return (
    <a
      href={safe}
      onClick={(e) => {
        if (safe.startsWith('http') || safe.startsWith('mailto:')) return;
        e.preventDefault();
        onNavigate(safe);
      }}
      className={className}
    >
      {children}
    </a>
  );
}

export function ContentChipLink({
  href,
  label,
  onNavigate,
}: {
  href: string;
  label: string;
  onNavigate: (path: string) => void;
}) {
  return (
    <ContentNavLink href={href} onNavigate={onNavigate} className={CONTENT_CHIP_CLASS}>
      <span className="line-clamp-2 text-left">{label}</span>
    </ContentNavLink>
  );
}

export function ContentLinkGroup({
  title,
  links,
  onNavigate,
}: {
  title: string;
  links: Array<{ label: string; href: string }>;
  onNavigate: (path: string) => void;
}) {
  if (!links.length) return null;
  return (
    <div>
      <h3 className="mb-3 font-display text-base font-semibold text-slate-900 dark:text-white sm:text-lg">
        {title}
      </h3>
      <ul className="flex flex-wrap gap-2.5">
        {links.map((l) => (
          <li key={`${l.href}-${l.label}`}>
            <ContentChipLink href={l.href} label={l.label} onNavigate={onNavigate} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ContentBreadcrumb({
  items,
  onNavigate,
}: {
  items: Array<{ label: string; href?: string }>;
  onNavigate: (path: string) => void;
}) {
  return (
    <nav
      className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-slate-500 dark:text-slate-400"
      aria-label="Breadcrumb"
    >
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          <span key={`${item.label}-${i}`} className="inline-flex items-center gap-1.5">
            {i > 0 && <ChevronRight className="h-4 w-4" />}
            {item.href && !isLast ? (
              <ContentNavLink
                href={item.href}
                onNavigate={onNavigate}
                className="cursor-pointer hover:text-teal-700 dark:hover:text-teal-300"
              >
                {item.label}
              </ContentNavLink>
            ) : (
              <span className={isLast ? 'line-clamp-1 text-slate-800 dark:text-slate-100' : ''}>
                {item.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}

export function ContentHero({
  eyebrow,
  icon,
  title,
  intro,
  meta,
}: {
  eyebrow?: string;
  icon?: ReactNode;
  title: string;
  intro?: string;
  meta?: ReactNode;
}) {
  return (
    <header className="overflow-hidden rounded-[1.75rem] border border-slate-200/80 bg-white shadow-sm dark:border-white/10 dark:bg-slate-900">
      <div className="border-b border-slate-100 bg-gradient-to-br from-slate-50 via-white to-teal-50/40 px-6 py-8 sm:px-10 sm:py-10 dark:border-white/10 dark:from-slate-900 dark:via-slate-900 dark:to-teal-950/20">
        {(eyebrow || icon) && (
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-teal-200/70 bg-white/80 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-teal-700 dark:border-teal-500/30 dark:bg-teal-500/10 dark:text-teal-300">
            {icon}
            {eyebrow}
          </div>
        )}
        <h1 className="w-full font-display text-3xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-4xl sm:leading-tight">
          {title}
        </h1>
        {intro && (
          <p className="mt-5 w-full text-base leading-relaxed text-slate-600 dark:text-slate-300 sm:text-lg">
            {intro}
          </p>
        )}
        {meta && (
          <div className="mt-4 text-sm text-slate-500 dark:text-slate-400">{meta}</div>
        )}
      </div>
    </header>
  );
}

export function ContentSectionHeading({
  id,
  children,
}: {
  id?: string;
  children: ReactNode;
}) {
  return (
    <h2
      id={id}
      className="scroll-mt-28 font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-[1.75rem]"
    >
      <span className="relative inline-block pb-2.5">
        {children}
        <span
          className="absolute bottom-0 left-0 h-[3px] w-14 rounded-full bg-teal-500 sm:w-16"
          aria-hidden
        />
      </span>
    </h2>
  );
}

export function ContentCard({ children, className = '', padded = true }: ContentCardProps) {
  return (
    <section
      className={`overflow-hidden rounded-[1.75rem] border border-slate-200/80 bg-white shadow-sm dark:border-white/10 dark:bg-slate-900 ${
        padded ? 'px-6 py-8 sm:px-10 sm:py-10' : ''
      } ${className}`}
    >
      {children}
    </section>
  );
}

export function ContentCtaBand({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-teal-200/60 bg-gradient-to-r from-teal-600 to-slate-900 px-6 py-7 text-white shadow-sm sm:px-8">
      <h2 className="font-display text-xl font-bold sm:text-2xl">{title}</h2>
      <div className="mt-2 max-w-2xl text-sm leading-relaxed text-teal-50/95 sm:text-base">
        {children}
      </div>
    </section>
  );
}

export default function ContentPageShell({ children }: { children: ReactNode }) {
  return <div className={CONTENT_PAGE_WIDTH}>{children}</div>;
}
