import { useMemo, useState } from 'react';
import { Pencil, Save } from 'lucide-react';
import { api, ApiError, type ArticleBlock, type ArticlePreview, type UpdatePublishedContentResponse } from './api';
import { Button, Callout, Tabs, Textarea } from './ui';

type EditMode = 'markdown' | 'json';

function blockText(block: ArticleBlock): string {
  if (typeof block.content === 'string') return block.content;
  if (Array.isArray(block.content)) return block.content.map(String).join('\n');
  if (block.content && typeof block.content === 'object') {
    return JSON.stringify(block.content, null, 2);
  }
  return '';
}

export function blocksToMarkdown(blocks: ArticleBlock[]): string {
  const lines: string[] = [];
  for (const b of blocks) {
    if (b.type === 'heading') {
      const h = b.heading || (typeof b.content === 'string' ? b.content : '');
      if (h.trim()) {
        lines.push(`## ${h.trim()}`, '');
      }
      continue;
    }
    if (b.type === 'list' && Array.isArray(b.content)) {
      for (const item of b.content) {
        lines.push(`- ${String(item)}`);
      }
      lines.push('');
      continue;
    }
    const text = blockText(b).trim();
    if (text) {
      lines.push(text, '');
    }
  }
  return lines.join('\n').trim();
}

export function markdownToBlocks(markdown: string): ArticleBlock[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: ArticleBlock[] = [];
  let para: string[] = [];
  let listItems: string[] = [];
  let seq = 0;
  const nextId = () => `manual-${Date.now()}-${seq++}`;

  const flushPara = () => {
    const text = para.join('\n').trim();
    if (text) blocks.push({ id: nextId(), type: 'paragraph', content: text });
    para = [];
  };
  const flushList = () => {
    if (listItems.length) {
      blocks.push({ id: nextId(), type: 'list', content: [...listItems] });
      listItems = [];
    }
  };

  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+)$/);
    const h3 = line.match(/^###\s+(.+)$/);
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (h2 || h3) {
      flushPara();
      flushList();
      const title = (h2?.[1] || h3?.[1] || '').trim();
      if (title) {
        blocks.push({ id: nextId(), type: 'heading', heading: title, content: title });
      }
    } else if (bullet) {
      flushPara();
      listItems.push(bullet[1]!.trim());
    } else if (line.trim() === '') {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return blocks;
}

function buildDraftJson(preview: ArticlePreview, rawDraft: unknown): string {
  const base =
    rawDraft && typeof rawDraft === 'object'
      ? { ...(rawDraft as Record<string, unknown>) }
      : {
          seo_title: preview.seo_package?.seo_title || '',
          meta_title: preview.seo_package?.meta_title || '',
          meta_description: preview.seo_package?.meta_description || '',
          excerpt: preview.excerpt || '',
        };
  return JSON.stringify({ ...base, blocks: preview.blocks }, null, 2);
}

export default function PublishedContentEditor({
  articleId,
  preview,
  rawDraft,
  disabled,
  onSaved,
  onCancel,
}: {
  articleId: number;
  preview: ArticlePreview;
  rawDraft: unknown;
  disabled?: boolean;
  onSaved: (message: string) => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<EditMode>('markdown');
  const [markdown, setMarkdown] = useState(() => blocksToMarkdown(preview.blocks));
  const [jsonDraft, setJsonDraft] = useState(() => buildDraftJson(preview, rawDraft));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const wordEstimate = useMemo(() => {
    const text = mode === 'markdown' ? markdown : jsonDraft;
    const words = text.split(/\s+/).filter(Boolean).length;
    return words;
  }, [mode, markdown, jsonDraft]);

  const handleUpdate = async () => {
    setBusy(true);
    setError('');
    try {
      let payload: { draft?: Record<string, unknown>; blocks?: ArticleBlock[] };
      if (mode === 'markdown') {
        const blocks = markdownToBlocks(markdown);
        if (!blocks.length) {
          setError('Add some content — use ## for section headings.');
          return;
        }
        payload = { blocks };
      } else {
        let parsed: unknown;
        try {
          parsed = JSON.parse(jsonDraft);
        } catch {
          setError('Invalid JSON — fix syntax before updating.');
          return;
        }
        if (Array.isArray(parsed)) {
          payload = { blocks: parsed as ArticleBlock[] };
        } else if (parsed && typeof parsed === 'object') {
          payload = { draft: parsed as Record<string, unknown> };
        } else {
          setError('JSON must be a draft object or blocks array.');
          return;
        }
      }

      const result = await api.post<UpdatePublishedContentResponse>(
        `/api/editorial/articles/${articleId}/update-content`,
        payload
      );

      if (!result.ok) {
        const detail = result.errors?.map((e) => e.message).filter(Boolean).join('; ');
        throw new Error(detail || result.message || 'Update failed');
      }
      onSaved(
        result.message +
          (result.word_count != null ? ` · ${result.word_count} words` : '')
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 rounded-2xl border border-teal-200 bg-teal-50/40 p-4 dark:border-teal-500/30 dark:bg-teal-500/5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-900 dark:text-white">
            <Pencil className="h-4 w-4 text-teal-600 dark:text-teal-400" />
            Edit published content
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Saves directly to the live blog — no AI review. Use Markdown for quick edits or Draft JSON
            to replace the full block structure.
          </p>
        </div>
        <Tabs
          items={[
            { key: 'markdown', label: 'Markdown' },
            { key: 'json', label: 'Draft JSON' },
          ]}
          active={mode}
          onChange={(k) => setMode(k as EditMode)}
        />
      </div>

      {mode === 'markdown' ? (
        <Textarea
          rows={16}
          value={markdown}
          disabled={disabled || busy}
          onChange={(e) => setMarkdown(e.target.value)}
          className="font-mono text-[13px] leading-relaxed"
          placeholder={'## Section title\n\nParagraph text…\n\n- Bullet one\n- Bullet two'}
        />
      ) : (
        <Textarea
          rows={16}
          value={jsonDraft}
          disabled={disabled || busy}
          onChange={(e) => setJsonDraft(e.target.value)}
          className="font-mono text-[12px] leading-relaxed"
          spellCheck={false}
        />
      )}

      <p className="text-[11px] text-slate-400">~{wordEstimate} words in editor</p>

      {error && <Callout tone="rose">{error}</Callout>}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          icon={<Save className="h-3.5 w-3.5" />}
          loading={busy}
          disabled={disabled || busy}
          onClick={() => void handleUpdate()}
        >
          Update
        </Button>
        <Button variant="outline" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
