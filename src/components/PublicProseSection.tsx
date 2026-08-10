import { ContentCard, ContentSectionHeading } from './ContentPageShell';

interface Props {
  id: string;
  title: string;
  paragraphs: string[];
  bullets?: string[];
}

/** Standard long-form section block matching ContentPageShell chrome. */
export default function PublicProseSection({ id, title, paragraphs, bullets }: Props) {
  return (
    <ContentCard>
      <div id={id} className="scroll-mt-28 space-y-4">
        <ContentSectionHeading>{title}</ContentSectionHeading>
        {paragraphs.filter(Boolean).map((p, i) => (
          <p
            key={`${id}-p-${i}`}
            className="text-[15px] leading-[1.8] text-slate-700 dark:text-slate-300 sm:text-base"
          >
            {p}
          </p>
        ))}
        {bullets && bullets.length > 0 && (
          <ul className="space-y-2.5 pl-1">
            {bullets.map((b) => (
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
  );
}
