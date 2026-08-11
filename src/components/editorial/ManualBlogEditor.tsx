import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Clock,
  Eye,
  Globe,
  ImageIcon,
  Save,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import { api, ApiError, type Article, type ArticleBlock, type ArticlePreview } from './api';
import {
  blocksToEditorHtml,
  editorHtmlToBlocks,
  extractFeaturedImage,
} from './manual-html-blocks';
import RichTextEditor, { htmlToPlainWordCount } from './RichTextEditor';
import {
  Badge,
  Button,
  Callout,
  Card,
  ConfirmDialog,
  Field,
  GlassPanel,
  Input,
  Select,
  StatusPill,
  Textarea,
} from './ui';

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

const WORDS_PER_MINUTE = 220;

function slugifyClient(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 120);
}

export interface FeaturedImageState {
  url: string;
  alt?: string;
}

export interface ManualSeoSuggestion {
  seo_title: string;
  meta_title: string;
  meta_description: string;
  slug: string;
  excerpt: string;
  primary_keyword: string;
  semantic_keywords: string[];
}

export default function ManualBlogEditor({
  mode,
  articleId,
  initial,
  topicId,
  articleStatus = 'draft',
  preview,
  onSaved,
  onPreview,
  onPublished,
  onCancel,
}: {
  mode: 'create' | 'edit';
  articleId?: number;
  initial?: Partial<Article> & { blocks?: ArticleBlock[]; draft_json?: unknown };
  topicId?: number | null;
  articleStatus?: string;
  preview?: ArticlePreview | null;
  onSaved?: (articleId: number, message: string) => void;
  onPreview?: (articleId: number) => void;
  onPublished?: () => void;
  onCancel?: () => void;
}) {
  const draftExtras =
    initial?.draft_json && typeof initial.draft_json === 'object'
      ? (initial.draft_json as Record<string, unknown>)
      : {};

  const [seoTitle, setSeoTitle] = useState(initial?.seo_title || '');
  const [metaTitle, setMetaTitle] = useState(initial?.meta_title || '');
  const [slug, setSlug] = useState(initial?.slug || '');
  const [slugTouched, setSlugTouched] = useState(Boolean(initial?.slug));
  const [metaDescription, setMetaDescription] = useState(initial?.meta_description || '');
  const [excerpt, setExcerpt] = useState(initial?.excerpt || '');
  const [contentType, setContentType] = useState(initial?.content_type || 'guide');
  const [primaryKeyword, setPrimaryKeyword] = useState(
    typeof draftExtras.primary_keyword === 'string' ? draftExtras.primary_keyword : ''
  );
  const [editorHtml, setEditorHtml] = useState(() =>
    initial?.blocks?.length ? blocksToEditorHtml(initial.blocks) : '<p></p>'
  );
  const [featuredImage, setFeaturedImage] = useState<FeaturedImageState | null>(() => {
    const fi = extractFeaturedImage(draftExtras);
    return fi ? { url: fi.url, alt: fi.alt } : null;
  });
  const [wordCount, setWordCount] = useState(() =>
    initial?.blocks?.length
      ? htmlToPlainWordCount(blocksToEditorHtml(initial.blocks))
      : 0
  );

  const [busy, setBusy] = useState<'save' | 'prepare' | 'publish' | 'seo' | 'upload' | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [seoSuggestion, setSeoSuggestion] = useState<ManualSeoSuggestion | null>(null);
  const [confirmReplaceSeo, setConfirmReplaceSeo] = useState(false);
  const [confirmSlugChange, setConfirmSlugChange] = useState(false);
  const [pendingSlug, setPendingSlug] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const initialSlugRef = useRef(initial?.slug || '');

  useEffect(() => {
    if (!slugTouched && seoTitle.trim()) {
      setSlug(slugifyClient(seoTitle));
    }
  }, [seoTitle, slugTouched]);

  const readingMinutes = useMemo(
    () => Math.max(1, Math.round(wordCount / WORDS_PER_MINUTE)),
    [wordCount]
  );

  const hasExistingSeo = Boolean(
    (metaTitle.trim() && metaTitle !== seoTitle) ||
      metaDescription.trim().length > 20 ||
      (slugTouched && slug.trim())
  );

  const buildPayload = useCallback(() => {
    const blocks = editorHtmlToBlocks(editorHtml);
    if (!blocks.length) throw new Error('Add some content to your article.');
    const title = seoTitle.trim();
    if (!title) throw new Error('Blog title is required');
    if (!metaDescription.trim()) throw new Error('Meta description is required');
    if (!excerpt.trim()) throw new Error('Excerpt is required');
    const finalSlug = (slug.trim() || slugifyClient(title)).trim();
    if (!finalSlug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(finalSlug)) {
      throw new Error('Slug must be lowercase letters, numbers, and hyphens only');
    }
    return {
      seo_title: title,
      meta_title: (metaTitle.trim() || title).trim(),
      meta_description: metaDescription.trim(),
      excerpt: excerpt.trim(),
      slug: finalSlug,
      content_type: contentType,
      topic_id: topicId ?? undefined,
      blocks,
      featured_image: featuredImage,
      primary_keyword: primaryKeyword.trim() || undefined,
    };
  }, [
    editorHtml,
    seoTitle,
    metaDescription,
    excerpt,
    slug,
    metaTitle,
    contentType,
    topicId,
    featuredImage,
    primaryKeyword,
  ]);

  const saveDraft = async (): Promise<number | null> => {
    setBusy('save');
    setError('');
    setMessage('');
    try {
      const payload = buildPayload();
      if (
        articleStatus === 'published' &&
        payload.slug !== initialSlugRef.current &&
        !confirmSlugChange
      ) {
        setPendingSlug(payload.slug);
        setConfirmSlugChange(true);
        return null;
      }
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
      setMessage(`Draft saved · ${wordCount} words`);
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
    const id = await saveDraft();
    if (!id) return;

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
      setMessage('Published — live at /blog/' + slug);
      onPublished?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Publish failed');
    } finally {
      setBusy(null);
    }
  };

  const handlePreview = async () => {
    const id = await saveDraft();
    if (id) onPreview?.(id);
  };

  const generateSeo = async () => {
    setBusy('seo');
    setError('');
    try {
      let id = articleId ?? null;
      if (!id) {
        id = await saveDraft();
        if (!id) return;
      }
      const blocks = editorHtmlToBlocks(editorHtml);
      const result = await api.post<{ ok: boolean; suggestion: ManualSeoSuggestion }>(
        `/api/editorial/articles/${id}/manual/generate-seo`,
        { seo_title: seoTitle, blocks, excerpt }
      );
      setSeoSuggestion(result.suggestion);
      if (!hasExistingSeo) {
        applySeoSuggestion(result.suggestion);
      } else {
        setConfirmReplaceSeo(true);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'SEO generation failed');
    } finally {
      setBusy(null);
    }
  };

  const applySeoSuggestion = (s: ManualSeoSuggestion) => {
    setSeoTitle(s.seo_title);
    setMetaTitle(s.meta_title);
    setMetaDescription(s.meta_description);
    setExcerpt(s.excerpt || excerpt);
    setPrimaryKeyword(s.primary_keyword);
    if (!slugTouched || !slug.trim()) {
      setSlug(s.slug);
    }
    setMessage('SEO fields updated — review and save draft');
    setSeoSuggestion(null);
    setConfirmReplaceSeo(false);
  };

  const uploadFeaturedImage = async (file: File) => {
    if (!articleId) {
      setError('Save the draft first, then upload a featured image');
      return;
    }
    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Image must be under 5MB');
      return;
    }
    setBusy('upload');
    setError('');
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
      });
      const result = await api.post<{ featured_image: FeaturedImageState }>(
        `/api/editorial/articles/${articleId}/featured-image`,
        { data_base64: dataUrl, mime: file.type, alt: seoTitle.slice(0, 120) }
      );
      setFeaturedImage(result.featured_image);
      setMessage('Featured image uploaded');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Upload failed');
    } finally {
      setBusy(null);
    }
  };

  const removeFeaturedImage = async () => {
    if (!articleId) {
      setFeaturedImage(null);
      return;
    }
    setBusy('upload');
    try {
      await api.delete(`/api/editorial/articles/${articleId}/featured-image`);
      setFeaturedImage(null);
      setMessage('Featured image removed');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Remove failed');
    } finally {
      setBusy(null);
    }
  };

  const seoPreviewUrl = `https://citycost.online/blog/${slug || 'your-slug'}`;
  const qualityScore = preview?.quality_score ?? preview?.quality_panel?.quality_score ?? null;
  const seoScore = preview?.seo_validation?.seo_score ?? preview?.quality_panel?.overall_seo_score ?? null;

  return (
    <div className="space-y-4">
      {/* Header actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={articleStatus} />
          <Badge tone="sky">Manual</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="primary"
            icon={<Save className="h-3.5 w-3.5" />}
            loading={busy === 'save'}
            disabled={busy != null && busy !== 'save'}
            onClick={() => void saveDraft()}
          >
            Save Draft
          </Button>
          <Button
            size="sm"
            variant="outline"
            icon={<Eye className="h-3.5 w-3.5" />}
            disabled={busy != null}
            onClick={() => void handlePreview()}
          >
            Preview
          </Button>
          <Button
            size="sm"
            variant="accent"
            icon={<Globe className="h-3.5 w-3.5" />}
            loading={busy === 'publish' || busy === 'prepare'}
            disabled={busy != null && busy !== 'publish' && busy !== 'prepare'}
            onClick={() => void publish()}
          >
            Publish
          </Button>
          {onCancel && (
            <Button size="sm" variant="ghost" disabled={busy != null} onClick={onCancel}>
              Cancel
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_300px]">
        {/* Main column */}
        <div className="space-y-4">
          <Card padding="p-5">
            <Field label="Blog title">
              <Input
                value={seoTitle}
                onChange={(e) => setSeoTitle(e.target.value)}
                placeholder="Article headline"
                className="text-base font-medium"
              />
            </Field>
          </Card>

          <Card padding="p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-900 dark:text-white">Content</p>
              <span className="text-xs text-slate-400">{wordCount} words · ~{readingMinutes} min read</span>
            </div>
            <RichTextEditor
              value={editorHtml}
              onChange={setEditorHtml}
              onWordCount={setWordCount}
              disabled={busy != null}
            />
          </Card>

          <Card padding="p-5">
            <Field label="Excerpt" hint="Shown on blog listing cards and article hero">
              <Textarea
                rows={3}
                value={excerpt}
                onChange={(e) => setExcerpt(e.target.value)}
                placeholder="Short summary for readers browsing /blog"
              />
            </Field>
          </Card>

          <GlassPanel padding="p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">Search engine listing</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">How this article may appear in Google</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                icon={<Sparkles className="h-3.5 w-3.5" />}
                loading={busy === 'seo'}
                disabled={busy != null && busy !== 'seo'}
                onClick={() => void generateSeo()}
              >
                Generate SEO with AI
              </Button>
            </div>

            <div className="mb-4 rounded-xl border border-slate-100 bg-slate-50/80 p-4 dark:border-white/10 dark:bg-white/[0.03]">
              <p className="text-xs text-slate-500">citycost.online › blog › {slug || '…'}</p>
              <p className="mt-1 text-base font-medium text-[#1a0dab] dark:text-blue-400">
                {metaTitle || seoTitle || 'SEO title preview'}
              </p>
              <p className="mt-0.5 line-clamp-2 text-sm text-slate-600 dark:text-slate-400">
                {metaDescription || 'Meta description preview…'}
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="SEO title">
                <Input value={metaTitle} onChange={(e) => setMetaTitle(e.target.value)} placeholder="Defaults to blog title" />
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
            </div>
            <Field label="Meta description" hint="150–160 characters recommended">
              <Textarea
                rows={2}
                value={metaDescription}
                onChange={(e) => setMetaDescription(e.target.value)}
                maxLength={320}
              />
              <span className="mt-1 block text-right text-[11px] text-slate-400">
                {metaDescription.length} chars
              </span>
            </Field>
            {primaryKeyword && (
              <p className="text-xs text-slate-500">
                Primary keyword: <span className="font-medium text-slate-700 dark:text-slate-300">{primaryKeyword}</span>
              </p>
            )}
          </GlassPanel>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <Card padding="p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Publishing</p>
            <div className="mt-2 space-y-1 text-sm">
              <p className="font-medium capitalize text-slate-800 dark:text-slate-100">{articleStatus.replace(/_/g, ' ')}</p>
              {initial?.published_at && (
                <p className="text-xs text-slate-500">Published {new Date(initial.published_at).toLocaleString()}</p>
              )}
              <p className="break-all text-xs text-slate-400">{seoPreviewUrl}</p>
            </div>
          </Card>

          <Card padding="p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Featured image</p>
            {featuredImage?.url ? (
              <div className="mt-3 space-y-3">
                <img
                  src={featuredImage.url}
                  alt={featuredImage.alt || seoTitle}
                  className="aspect-[16/9] w-full rounded-xl border border-slate-200 object-cover dark:border-white/10"
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    icon={<Upload className="h-3.5 w-3.5" />}
                    disabled={busy != null}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Replace
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Trash2 className="h-3.5 w-3.5" />}
                    disabled={busy != null}
                    onClick={() => void removeFeaturedImage()}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                disabled={busy != null}
                onClick={() => fileInputRef.current?.click()}
                className="mt-3 flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 px-4 py-8 text-center transition hover:border-teal-400 hover:bg-teal-50/30 dark:border-white/10 dark:hover:border-teal-500/40 dark:hover:bg-teal-500/5"
              >
                <ImageIcon className="h-8 w-8 text-slate-300 dark:text-slate-600" />
                <span className="text-sm font-medium text-slate-600 dark:text-slate-300">Upload featured image</span>
                <span className="text-xs text-slate-400">JPEG, PNG, WebP · max 5MB</span>
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadFeaturedImage(f);
                e.target.value = '';
              }}
            />
          </Card>

          <Card padding="p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Organization</p>
            <div className="mt-3 space-y-3">
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
          </Card>

          <Card padding="p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Quality summary</p>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">Words</dt>
                <dd className="font-medium tabular-nums text-slate-800 dark:text-slate-100">{wordCount}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Reading time</dt>
                <dd className="inline-flex items-center gap-1 font-medium text-slate-800 dark:text-slate-100">
                  <Clock className="h-3.5 w-3.5 opacity-50" />
                  {readingMinutes} min
                </dd>
              </div>
              {qualityScore != null && (
                <div className="flex justify-between">
                  <dt className="text-slate-500">Quality</dt>
                  <dd className="font-medium tabular-nums">{qualityScore}</dd>
                </div>
              )}
              {seoScore != null && (
                <div className="flex justify-between">
                  <dt className="text-slate-500">SEO score</dt>
                  <dd className="font-medium tabular-nums">{seoScore}</dd>
                </div>
              )}
            </dl>
          </Card>
        </div>
      </div>

      {message && <Callout tone="emerald">{message}</Callout>}
      {error && <Callout tone="rose">{error}</Callout>}

      {confirmReplaceSeo && seoSuggestion && (
        <ConfirmDialog
          title="Replace existing SEO?"
          body="Your SEO fields already have values. Replace them with AI-generated suggestions?"
          confirmLabel="Replace"
          onCancel={() => {
            setConfirmReplaceSeo(false);
            setSeoSuggestion(seoSuggestion);
          }}
          onConfirm={() => applySeoSuggestion(seoSuggestion)}
        />
      )}

      {confirmSlugChange && (
        <ConfirmDialog
          title="Change published URL?"
          body={
            <p>
              Changing the slug will break the existing public URL{' '}
              <code className="rounded bg-slate-100 px-1 dark:bg-white/10">/blog/{initialSlugRef.current}</code>.
              Continue with <strong>{pendingSlug}</strong>?
            </p>
          }
          confirmLabel="Change slug"
          danger
          onCancel={() => setConfirmSlugChange(false)}
          onConfirm={() => {
            setConfirmSlugChange(false);
            setSlug(pendingSlug);
            void saveDraft();
          }}
        />
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
