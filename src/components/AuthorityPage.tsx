import type { ReactNode } from 'react';
import { BookOpen } from 'lucide-react';
import type { AuthorityPageDoc } from '../../lib/eeat-engine/types.js';
import { AUTHORITY_FOOTER_LINKS } from '../../lib/eeat-engine/links.js';
import ContentPageShell, {
  ContentBreadcrumb,
  ContentCard,
  ContentCtaBand,
  ContentHero,
  ContentLinkGroup,
  ContentSectionHeading,
} from './ContentPageShell';

interface Props {
  doc: AuthorityPageDoc;
  onNavigate: (path: string) => void;
}

/** Shared layout for methodology, about, legal, and related authority pages. */
export default function AuthorityPage({ doc, onNavigate }: Props) {
  return (
    <ContentPageShell>
      <ContentBreadcrumb
        onNavigate={onNavigate}
        items={[{ label: 'Home', href: '/' }, { label: doc.h1 }]}
      />

      <ContentHero
        eyebrow="CityCost Trust"
        icon={<BookOpen className="h-3.5 w-3.5" />}
        title={doc.h1}
        intro={doc.intro}
        meta={<span>Last updated: {doc.last_updated}</span>}
      />

      {doc.sections.map((section) => (
        <div key={section.id}>
        <ContentCard>
          <div className="space-y-4">
            <ContentSectionHeading id={section.id}>{section.title}</ContentSectionHeading>
            {section.paragraphs.map((p, i) => (
              <p
                key={i}
                className="whitespace-pre-wrap text-[15px] leading-[1.8] text-slate-700 dark:text-slate-300 sm:text-base"
              >
                {renderPossiblyMailto(p)}
              </p>
            ))}
            {section.bullets && section.bullets.length > 0 && (
              <ul className="space-y-2.5 pl-1">
                {section.bullets.map((b) => (
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

      <ContentCard>
        <ContentLinkGroup
          title="Related authority pages"
          links={AUTHORITY_FOOTER_LINKS.filter((l) => l.href !== doc.path)}
          onNavigate={onNavigate}
        />
      </ContentCard>

      <ContentCtaBand title="Compare cities with real indexes">
        Open the{' '}
        <button
          type="button"
          onClick={() => onNavigate('/')}
          className="font-bold underline decoration-white/50 underline-offset-2 hover:decoration-white"
        >
          CityCost calculator
        </button>{' '}
        to compare rent, groceries, and purchasing power side by side.
      </ContentCtaBand>
    </ContentPageShell>
  );
}

function renderPossiblyMailto(text: string): ReactNode {
  const idx = text.indexOf('mailto:');
  if (idx === -1) return text;
  const before = text.slice(0, idx);
  const rest = text.slice(idx);
  const space = rest.search(/\s/);
  const href = space === -1 ? rest : rest.slice(0, space);
  const after = space === -1 ? '' : rest.slice(space);
  return (
    <>
      {before}
      <a
        href={href}
        className="break-all font-semibold text-teal-700 underline decoration-teal-400/70 underline-offset-2 dark:text-teal-300"
      >
        {href.replace(/^mailto:/, '').split('?')[0]}
      </a>
      {after}
    </>
  );
}
