import { useEffect, useMemo, useState } from 'react';
import { Eye, FileText, Globe, Save } from 'lucide-react';
import { api, ApiError, type Article, type ArticleBlock } from './api';
import { blocksToMarkdown, markdownToBlocks } from './PublishedContentEditor';
import { Button, Callout, Field, Input, Select, Textarea } from './ui';

const CONTENT_TYPES = [
  'guide',
  'country_guide',
  'city_guide',
  'comparison_guide',
  'salary_guide',
  'rent_guide',
  'food_guide',
  'transportation_guide',
  'healthcare_guide',
  'tax_guide',
  'student_guide',
  'remote_worker_guide',
  'retirement_guide',
  'moving_guide',
  'budget_guide',
  'visa_guide',
];

function slugifyClient(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 120);
}

export default function ManualBlogEditor({
  mode,
  articleId,
  initial,
  topicId,
  onSaved,
  onPreview,
  onPublished,
  onCancel,
}: {
  mode: 'create' | 'edit';
  articleId?: number;
  initial?: Partial<Article> & { blocks?: ArticleBlock[] };
  topicId?: number | null;
  onSaved?: (articleId: number, message: string) => void;
  onPreview?: (articleId: number) => void;
  onPublished?: () => void;
  onCancel?: () => void;
}) {
  const [seoTitle, setSeoTitle] = useState(initial?.seo_title || '');
  const [metaTitle, setMetaTitle] = useState(initial?.meta_title || '');
  const [slug, setSlug] = useState(initial?.slug || '');
  const [slugTouched, setSlugTouched] = useState(Boolean(initial?.slug));
  const [metaDescription, setMetaDescription] = useState(initial?.meta_description || '');
  const [excerpt, setExcerpt] = useState(initial?.excerpt || '');
  const [contentType, setContentType] = useState(initial?.content_type || 'guide');
  const [markdown, setMarkdown] = useState(() =>
    initial?.blocks?.length ? blocksToMarkdown(initial.blocks) : '## Introduction\n\nStart writing here…'
  );
  const [busy, setBusy] = useState<'save' | 'prepare' | 'publish' | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!slugTouched && seoTitle.trim()) {
      setSlug(slugifyClient(seoTitle));
    }
  }, [seoTitle, slugTouched]);

  const wordEstimate = useMemo(
    () => markdown.split(/\s+/).filter(Boolean).length,
    [markdown]
  );

  const buildPayload = () => {
    const blocks = markdownToBlocks(markdown);
    if (!blocks.length) throw new Error('Add content — use ## for section headings.');
    const title = seoTitle.trim();
    if (!title) throw new Error('Blog title is required');
    if (!metaDescription.trim()) throw new Error('Meta description is required');
    if (!excerpt.trim()) throw new Error('Excerpt is required');
    const finalSlug = (slug.trim() || slugifyClient(title)).trim();
    if (!finalSlug) throw new Error('Slug is required');
    return {
      seo_title: title,
      meta_title: (metaTitle.trim() || title).trim(),
      meta_description: metaDescription.trim(),
      excerpt: excerpt.trim(),
      slug: finalSlug,
      content_type: contentType,
      topic_id: topicId ?? undefined,
      blocks,
    };
  };

  const saveDraft = async (): Promise<number | null> => {
    setBusy('save');
    setError('');
    setMessage('');
    try {
      const payload = buildPayload();
      if (mode === 'create') {
        const result = await api.post<{ article_id: number; slug: string }>(
          '/api/editorial/articles/manual',
          payload
        );
        setMessage('Draft saved');
        onSaved?.(result.article_id, 'Draft created');
        return result.article_id;
      }
      if (!articleId) throw new Error('Missing article id');
      await api.put<{ ok: true; word_count: number }>(
        `/api/editorial/articles/${articleId}/manual`,
        payload
      );
      setMessage(`Draft saved · ${wordEstimate} words`);
      onSaved?.(articleId, 'Draft saved');
      return articleId;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Save failed');
      return null;
    } finally {
      setBusy(null);
    }
  };

  const preparePublish = async (id: number) => {
    setBusy('prepare');
    setError('');
    try {
      const result = await api.post<{ ok: boolean; message: string }>(
        `/api/editorial/articles/${id}/prepare-manual-publish`
      );
      if (!result.ok) throw new Error(result.message || 'Prepare failed');
      setMessage(result.message);
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Prepare failed');
      return false;
    } finally {
      setBusy(null);
    }
  };

  const publish = async () => {
    setError('');
    let id = articleId ?? null;
    if (!id) {
      id = await saveDraft();
      if (!id) return;
    } else {
      const saved = await saveDraft();
      if (!saved) return;
      id = saved;
    }

    setBusy('publish');
    try {
      const prepared = await preparePublish(id);
      if (!prepared) return;

      const result = await api.post<{ ok: boolean; message: string; errors?: Array<{ message: string }> }>(
        `/api/editorial/articles/${id}/publish`
      );
      if (!result.ok) {
        const detail = result.errors?.map((e) => e.message).join('; ');
        throw new Error(detail || result.message || 'Publish failed');
      }
      setMessage('Published — live on /blog/' + (slug.trim() || slugifyClient(seoTitle)));
      onPublished?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Publish failed');
    } finally {
      setBusy(null);
    }
  };

  const handlePreview = async () => {
    let id = articleId ?? null;
    if (!id) {
      id = await saveDraft();
      if (!id) return;
    } else {
      const saved = await saveDraft();
      if (!saved) return;
      id = saved;
    }
    onPreview?.(id);
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Blog title">
          <Input value={seoTitle} onChange={(e) => setSeoTitle(e.target.value)} placeholder="Article headline" />
        </Field>
        <Field label="SEO title">
          <Input
            value={metaTitle}
            onChange={(e) => setMetaTitle(e.target.value)}
            placeholder="Defaults to blog title"
          />
        </Field>
        <Field label="Slug">
          <Input
            value={slug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value);
            }}
            placeholder="url-friendly-slug"
          />
        </Field>
        <Field label="Content type">
          <Select value={contentType} onChange={(e) => setContentType(e.target.value)}>
            {CONTENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, ' ')}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="Excerpt">
        <Textarea
          rows={2}
          value={excerpt}
          onChange={(e) => setExcerpt(e.target.value)}
          placeholder="Short summary for blog listing cards"
        />
      </Field>

      <Field label="Meta description">
        <Textarea
          rows={2}
          value={metaDescription}
          onChange={(e) => setMetaDescription(e.target.value)}
          placeholder="Search snippet (150–160 characters recommended)"
        />
      </Field>

      <Field
        label="Content"
        hint="## H2 · ### H3 · **bold** · *italic* · [links](/blog) · - bullets · 1. numbered · > blockquotes"
      >
        <Textarea
          rows={18}
          value={markdown}
          onChange={(e) => setMarkdown(e.target.value)}
          className="font-mono text-[13px] leading-relaxed"
          placeholder={'## Section\n\nParagraph with [internal link](/blog)…'}
        />
      </Field>

      <p className="text-[11px] text-slate-400">~{wordEstimate} words · stored as editorial blocks (same format as AI drafts)</p>

      {message && <Callout tone="emerald">{message}</Callout>}
      {error && <Callout tone="rose">{error}</Callout>}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          icon={<Save className="h-3.5 w-3.5" />}
          loading={busy === 'save'}
          disabled={busy != null && busy !== 'save'}
          onClick={() => void saveDraft()}
        >
          Save Draft
        </Button>
        <Button
          variant="outline"
          icon={<Eye className="h-3.5 w-3.5" />}
          disabled={busy != null}
          onClick={() => void handlePreview()}
        >
          Preview
        </Button>
        <Button
          variant="accent"
          icon={<Globe className="h-3.5 w-3.5" />}
          loading={busy === 'publish' || busy === 'prepare'}
          disabled={busy != null && busy !== 'publish' && busy !== 'prepare'}
          onClick={() => void publish()}
        >
          Publish
        </Button>
        {onCancel && (
          <Button variant="ghost" disabled={busy != null} onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>

      {mode === 'create' && (
        <p className="flex items-start gap-2 text-xs text-slate-500 dark:text-slate-400">
          <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Manual blogs skip AI draft generation. Publish runs SEO packaging only — quality review is optional.
        </p>
      )}
    </div>
  );
}

export function isManualArticle(article: Pick<Article, 'prompt_hash' | 'ai_model'>): boolean {
  return article.prompt_hash === 'manual' || article.ai_model === 'manual';
}

export function isManualTopic(topic: { source_refs_json?: Record<string, unknown> | null }): boolean {
  return topic.source_refs_json?.origin === 'manual';
}
