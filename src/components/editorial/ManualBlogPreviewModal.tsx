import { useMemo } from 'react';
import type { ArticleBlock } from './api';
import { Button, Divider } from './ui';
import {
  PreviewHeading,
  RenderBlockBody,
  headingLabel,
  isTocBlock,
  normHeading,
  sectionAnchor,
  shouldShowHeading,
} from './wizard/article-content-render';
import type { FeaturedImageState } from './ManualBlogEditor';

export default function ManualBlogPreviewModal({
  open,
  onClose,
  title,
  slug,
  excerpt,
  blocks,
  featuredImage,
  wordCount,
  readingMinutes,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  slug: string;
  excerpt: string;
  blocks: ArticleBlock[];
  featuredImage: FeaturedImageState | null;
  wordCount: number;
  readingMinutes: number;
}) {
  const headingToAnchor = useMemo(() => {
    const map = new Map<string, string>();
    let idx = 0;
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i]!;
      if (!shouldShowHeading(b, i, blocks)) continue;
      if (isTocBlock(b)) continue;
      const label = headingLabel(b);
      if (!label || /^table of contents|^contents$/i.test(label)) continue;
      idx += 1;
      map.set(normHeading(label), sectionAnchor(label, idx));
    }
    return map;
  }, [blocks]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-3 backdrop-blur-sm sm:p-6">
      <div className="editorial-fade-in flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-white/10 dark:bg-slate-950">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3 dark:border-white/10">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-teal-700 dark:text-teal-400">
              Blog preview
            </p>
            <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">
              {title || 'Untitled'}
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
        <div className="overflow-y-auto px-5 py-6 sm:px-8">
          <article className="mx-auto max-w-2xl">
            <p className="text-xs text-slate-400">/blog/{slug || 'your-slug'}</p>
            <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
              {title || 'Untitled'}
            </h1>
            {excerpt && (
              <p className="mt-3 text-base text-slate-600 dark:text-slate-300">{excerpt}</p>
            )}
            {featuredImage?.url && (
              <img
                src={featuredImage.url}
                alt={featuredImage.alt || title || 'Featured'}
                className="mt-5 h-auto w-full max-w-full rounded-xl border border-slate-200 dark:border-white/10"
              />
            )}
            <p className="mt-2 text-xs text-slate-400">
              {wordCount} words · ~{readingMinutes} min read · Draft preview (not live)
            </p>
            <Divider className="my-6" />
            <div className="space-y-5 text-[15px] leading-relaxed text-slate-700 dark:text-slate-200">
              {blocks.map((b, i) => {
                const showH = shouldShowHeading(b, i, blocks);
                const label = headingLabel(b);
                return (
                  <section key={b.id || i}>
                    {showH && label && (
                      b.type === 'heading' ? (
                        <PreviewHeading block={b} />
                      ) : (
                        <h2 className="mb-2 font-display text-xl font-semibold text-slate-900 dark:text-white">
                          {label}
                        </h2>
                      )
                    )}
                    {b.type !== 'heading' && (
                      <RenderBlockBody block={b} headingToAnchor={headingToAnchor} />
                    )}
                  </section>
                );
              })}
            </div>
          </article>
        </div>
      </div>
    </div>
  );
}
