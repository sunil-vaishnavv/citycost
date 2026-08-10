import { useState } from 'react';
import { ChevronDown, Compass } from 'lucide-react';
import type { IntentLandingPublic } from '../../lib/search-intent/types.js';
import ContentPageShell, {
  ContentBreadcrumb,
  ContentCard,
  ContentCtaBand,
  ContentHero,
  ContentLinkGroup,
  ContentSectionHeading,
} from './ContentPageShell';
import { RichText } from './RichText';

interface Props {
  data: IntentLandingPublic;
  onNavigate: (path: string) => void;
}

function LinkGroup({
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
    <ContentCard>
      <ContentLinkGroup title={title} links={links} onNavigate={onNavigate} />
    </ContentCard>
  );
}

function FaqAccordion({
  items,
  onNavigate,
}: {
  items: Array<{ q: string; a: string }>;
  onNavigate: (path: string) => void;
}) {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 dark:divide-white/10 dark:border-white/10">
      {items.map((item, i) => {
        const isOpen = open === i;
        return (
          <div key={item.q} className="bg-white dark:bg-slate-900/80">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left transition hover:bg-slate-50 dark:hover:bg-white/[0.03] sm:px-5"
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? null : i)}
            >
              <span className="text-sm font-semibold text-slate-900 dark:text-white sm:text-base">
                {item.q}
              </span>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-teal-600 transition-transform dark:text-teal-400 ${
                  isOpen ? 'rotate-180' : ''
                }`}
              />
            </button>
            {isOpen && (
              <div className="border-t border-slate-100 px-4 pb-4 pt-1 text-[15px] leading-relaxed text-slate-600 dark:border-white/10 dark:text-slate-300 sm:px-5 sm:text-base">
                <RichText text={item.a} onNavigate={onNavigate} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Intent landing / category / country-guide view — matches blog single-page chrome. */
export default function IntentLandingPage({ data, onNavigate }: Props) {
  const g = data.graph;
  const crumbs: Array<{ label: string; href?: string }> = [{ label: 'Home', href: '/' }];
  if (g.parent) crumbs.push({ label: g.parent.label, href: g.parent.href });
  crumbs.push({ label: data.h1 });

  return (
    <ContentPageShell>
      <ContentBreadcrumb onNavigate={onNavigate} items={crumbs} />

      <ContentHero
        eyebrow="CityCost Guide"
        icon={<Compass className="h-3.5 w-3.5" />}
        title={data.h1}
        intro={data.intro}
        meta={
          <div className="space-y-1">
            <p>Last updated: {data.last_updated}</p>
            {data.city && (
              <p className="text-xs">
                {data.city.data_source ? `Source: ${data.city.data_source}` : ''}
                {data.city.confidence_label
                  ? ` · Confidence: ${data.city.confidence_label}`
                  : ''}
              </p>
            )}
          </div>
        }
      />

      {data.sections.map((s) => (
        <div key={s.id}>
        <ContentCard>
          <div className="space-y-4">
            <ContentSectionHeading id={s.id}>{s.title}</ContentSectionHeading>
            {s.paragraphs.map((p, i) => (
              <p
                key={i}
                className="text-[15px] leading-[1.8] text-slate-700 dark:text-slate-300 sm:text-base"
              >
                {p}
              </p>
            ))}
            {s.bullets && s.bullets.length > 0 && (
              <ul className="space-y-2.5 pl-1">
                {s.bullets.map((b) => (
                  <li
                    key={b}
                    className="flex gap-3 text-[15px] leading-relaxed text-slate-700 dark:text-slate-300"
                  >
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-500" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </ContentCard>
        </div>
      ))}

      {data.faqs.length > 0 && (
        <ContentCard>
          <div className="space-y-4">
            <ContentSectionHeading>FAQ</ContentSectionHeading>
            <FaqAccordion items={data.faqs} onNavigate={onNavigate} />
          </div>
        </ContentCard>
      )}

      <LinkGroup title="Cluster pages" links={g.siblings} onNavigate={onNavigate} />
      <LinkGroup title="Related guides" links={g.related_guides} onNavigate={onNavigate} />
      <LinkGroup title="Related cities" links={g.related_cities} onNavigate={onNavigate} />
      <LinkGroup title="Related comparisons" links={g.related_comparisons} onNavigate={onNavigate} />
      <LinkGroup title="Categories" links={g.related_categories} onNavigate={onNavigate} />
      <LinkGroup title="Countries" links={g.related_countries} onNavigate={onNavigate} />

      <ContentCtaBand title="Next step">
        Verify costs with the{' '}
        <button
          type="button"
          onClick={() => onNavigate('/')}
          className="font-bold underline decoration-white/50 underline-offset-2 hover:decoration-white"
        >
          CityCost calculator
        </button>
        .
      </ContentCtaBand>
    </ContentPageShell>
  );
}
