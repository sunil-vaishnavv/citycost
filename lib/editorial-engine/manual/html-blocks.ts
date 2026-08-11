/**
 * Convert between TipTap/editor HTML and editorial DraftBlock[].
 * Backward-compatible with markdown-era manual blocks and AI blocks.
 */

import type { DraftBlock } from '../writer/draft-validate.js';

export interface FeaturedImageMeta {
  url: string;
  alt?: string;
  path?: string;
}

export interface ManualDraftExtras {
  featured_image?: FeaturedImageMeta | null;
  primary_keyword?: string;
  semantic_keywords?: string[];
}

function nextId(seq: { n: number }): string {
  seq.n += 1;
  return `blk-${Date.now()}-${seq.n}`;
}

function headingLevel(block: DraftBlock): number {
  const c = block.content;
  if (c && typeof c === 'object' && !Array.isArray(c) && 'level' in c) {
    const level = Number((c as { level?: number }).level);
    if (level >= 2 && level <= 4) return level;
  }
  return 2;
}

function headingText(block: DraftBlock): string {
  if (block.heading?.trim()) return block.heading.trim();
  const c = block.content;
  if (typeof c === 'string') return c.trim();
  if (c && typeof c === 'object' && !Array.isArray(c) && 'text' in c) {
    return String((c as { text?: string }).text || '').trim();
  }
  return '';
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function blockContentString(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(String).join('\n');
  if (content && typeof content === 'object') {
    const o = content as { text?: string; body?: string; items?: unknown[] };
    if (typeof o.text === 'string') return o.text;
    if (typeof o.body === 'string') return o.body;
    if (Array.isArray(o.items)) return o.items.map(String).join('\n');
  }
  return '';
}

function listItems(content: unknown): { items: string[]; ordered: boolean } {
  if (Array.isArray(content)) {
    return { items: content.map((x) => String(x)), ordered: false };
  }
  if (content && typeof content === 'object') {
    const o = content as { items?: unknown[]; ordered?: boolean };
    if (Array.isArray(o.items)) {
      return { items: o.items.map((x) => String(x)), ordered: Boolean(o.ordered) };
    }
  }
  const text = blockContentString(content).trim();
  return { items: text ? [text] : [], ordered: false };
}

function tableFromContent(content: unknown): { headers: string[]; rows: string[][] } | null {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return null;
  const o = content as { headers?: unknown[]; columns?: unknown[]; rows?: unknown[] };
  const rowsRaw = Array.isArray(o.rows) ? o.rows : null;
  if (!rowsRaw?.length) return null;
  const rows = rowsRaw.map((r) =>
    Array.isArray(r) ? r.map((c) => String(c ?? '')) : [String(r)]
  );
  const headers = Array.isArray(o.headers)
    ? o.headers.map(String)
    : Array.isArray(o.columns)
      ? o.columns.map(String)
      : [];
  return { headers, rows };
}

/** Plain text for word count / AI SEO — strips HTML. */
export function blocksToPlainText(blocks: DraftBlock[]): string {
  const parts: string[] = [];
  for (const b of blocks || []) {
    if (b.type === 'heading') {
      const t = headingText(b);
      if (t) parts.push(t);
      continue;
    }
    if (b.type === 'list') {
      const { items } = listItems(b.content);
      parts.push(...items.map(stripHtml));
      continue;
    }
    if (b.type === 'table' || b.type === 'comparison') {
      const t = tableFromContent(b.content);
      if (t) {
        parts.push(...t.headers);
        for (const row of t.rows) parts.push(...row);
      }
      continue;
    }
    if (b.type === 'faq' && Array.isArray(b.content)) {
      for (const item of b.content) {
        if (!item || typeof item !== 'object') continue;
        const o = item as { q?: string; a?: string; question?: string; answer?: string };
        parts.push(stripHtml(o.q || o.question || ''));
        parts.push(stripHtml(o.a || o.answer || ''));
      }
      continue;
    }
    const text = blockContentString(b.content);
    if (text) parts.push(stripHtml(text));
    if (b.heading?.trim()) parts.push(b.heading.trim());
  }
  return parts.filter(Boolean).join('\n\n');
}

export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

export function countWordsFromBlocks(blocks: DraftBlock[]): number {
  const text = blocksToPlainText(blocks);
  return text.split(/\s+/).filter(Boolean).length;
}

export function containsHtml(text: string): boolean {
  return /<[a-z][\s\S]*>/i.test(text);
}

/** Strip dangerous markup while preserving limited rich-text tags (Node + browser). */
export function sanitizeRichHtml(html: string): string {
  let out = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<\/?(?:html|body|head|meta|link|object|embed|form|input|button|textarea|select)[^>]*>/gi, '');
  out = out.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  out = out.replace(/\shref\s*=\s*("|\')\s*javascript:[^"\']*\1/gi, '');
  out = out.replace(/<img\b([^>]*?)>/gi, (_m, attrs: string) => {
    const src = /src\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
    const raw = src?.[2] || src?.[3] || src?.[4] || '';
    if (!raw.startsWith('/') && !raw.startsWith('https://')) return '';
    const alt = /alt\s*=\s*("([^"]*)"|'([^']*)')/i.exec(attrs);
    const altText = alt?.[2] || alt?.[3] || '';
    return `<img src="${raw.replace(/"/g, '&quot;')}" alt="${altText.replace(/"/g, '&quot;')}" loading="lazy" />`;
  });
  // Drop any tag not in allowlist (keep inner text)
  out = out.replace(/<\/?([a-z][a-z0-9]*)\b[^>]*>/gi, (tag, name: string) => {
    const allowed = [
      'p',
      'br',
      'strong',
      'b',
      'em',
      'i',
      'u',
      'a',
      'ul',
      'ol',
      'li',
      'h3',
      'h4',
      'blockquote',
      'span',
      'img',
    ];
    return allowed.includes(name.toLowerCase()) ? tag : '';
  });
  return out.trim();
}

export function listItemsFromContent(content: unknown): { items: string[]; ordered: boolean } {
  return listItems(content);
}

export function blockHeadingLevel(block: DraftBlock): number {
  return headingLevel(block);
}

export function blockHeadingText(block: DraftBlock): string {
  return headingText(block);
}

/** Load editorial blocks into editor HTML. */
export function blocksToEditorHtml(blocks: DraftBlock[]): string {
  const parts: string[] = [];
  for (const b of blocks || []) {
    if (b.type === 'heading') {
      const level = headingLevel(b);
      const text = headingText(b);
      if (text) parts.push(`<h${level}>${escapeHtml(text)}</h${level}>`);
      continue;
    }
    if (b.type === 'list') {
      const { items, ordered } = listItems(b.content);
      if (!items.length) continue;
      const tag = ordered ? 'ol' : 'ul';
      parts.push(
        `<${tag}>${items.map((item) => `<li>${item.includes('<') ? item : escapeHtml(item)}</li>`).join('')}</${tag}>`
      );
      continue;
    }
    if (b.type === 'table' || b.type === 'comparison') {
      const t = tableFromContent(b.content);
      if (t) {
        const head = t.headers.length
          ? `<thead><tr>${t.headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>`
          : '';
        const body = t.rows
          .map((row) => `<tr>${row.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`)
          .join('');
        parts.push(`<table>${head}<tbody>${body}</tbody></table>`);
      }
      continue;
    }
    if (b.type === 'tip' || b.type === 'warning') {
      const inner = blockContentString(b.content);
      if (inner) parts.push(`<blockquote>${inner}</blockquote>`);
      continue;
    }
    if (b.type === 'faq') continue;

    const inner = blockContentString(b.content);
    if (!inner && !b.heading) continue;
    if (b.heading && b.type !== 'intro' && b.type !== 'paragraph' && b.type !== 'summary') {
      parts.push(`<h2>${escapeHtml(b.heading)}</h2>`);
    }
    if (inner) {
      if (containsHtml(inner) || inner.includes('<img')) {
        parts.push(inner.startsWith('<') ? inner : `<p>${inner}</p>`);
      } else {
        parts.push(`<p>${escapeHtml(inner).replace(/\n/g, '<br>')}</p>`);
      }
    }
  }
  if (!parts.length) return '<p></p>';
  return parts.join('');
}

function parseTableElement(el: HTMLElement): { headers: string[]; rows: string[][] } {
  const headers: string[] = [];
  const thead = el.querySelector('thead');
  if (thead) {
    const ths = thead.querySelectorAll('th');
    ths.forEach((th) => headers.push(th.innerHTML.trim()));
  }
  const rows: string[][] = [];
  el.querySelectorAll('tbody tr, tr').forEach((tr) => {
    if (tr.closest('thead')) return;
    const cells = [...tr.querySelectorAll('td, th')].map((c) => c.innerHTML.trim());
    if (cells.length) rows.push(cells);
  });
  return { headers, rows };
}

/** Save editor HTML as editorial blocks (browser DOMParser). */
export function editorHtmlToBlocks(html: string): DraftBlock[] {
  if (typeof DOMParser === 'undefined') {
    throw new Error('editorHtmlToBlocks requires DOMParser (browser)');
  }
  const wrapped = html.trim().startsWith('<') ? html : `<p>${escapeHtml(html)}</p>`;
  const doc = new DOMParser().parseFromString(`<div id="root">${wrapped}</div>`, 'text/html');
  const root = doc.getElementById('root');
  if (!root) return [];

  const blocks: DraftBlock[] = [];
  const seq = { n: 0 };

  const walk = (nodes: NodeListOf<ChildNode> | ChildNode[]) => {
    for (const node of nodes) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const el = node as HTMLElement;
      const tag = el.tagName.toLowerCase();

      if (tag === 'h2' || tag === 'h3' || tag === 'h4') {
        const level = Number(tag[1]) || 2;
        const text = el.textContent?.trim() || '';
        if (text) {
          blocks.push({
            id: nextId(seq),
            type: 'heading',
            heading: text,
            content: { level, text },
          });
        }
        continue;
      }

      if (tag === 'p') {
        const inner = el.innerHTML.trim();
        if (inner) {
          blocks.push({ id: nextId(seq), type: 'paragraph', content: inner });
        }
        continue;
      }

      if (tag === 'ul' || tag === 'ol') {
        const items = [...el.querySelectorAll(':scope > li')].map((li) => li.innerHTML.trim()).filter(Boolean);
        if (items.length) {
          blocks.push({
            id: nextId(seq),
            type: 'list',
            content: { items, ordered: tag === 'ol' },
          });
        }
        continue;
      }

      if (tag === 'blockquote') {
        const inner = el.innerHTML.trim();
        if (inner) {
          blocks.push({ id: nextId(seq), type: 'tip', heading: 'Quote', content: inner });
        }
        continue;
      }

      if (tag === 'table') {
        blocks.push({ id: nextId(seq), type: 'table', content: parseTableElement(el) });
        continue;
      }

      if (tag === 'img') {
        const src = el.getAttribute('src') || '';
        const alt = el.getAttribute('alt') || '';
        if (src) {
          blocks.push({
            id: nextId(seq),
            type: 'paragraph',
            content: `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" />`,
          });
        }
        continue;
      }

      if (tag === 'figure') {
        const img = el.querySelector('img');
        if (img) {
          const src = img.getAttribute('src') || '';
          const alt = img.getAttribute('alt') || '';
          if (src) {
            blocks.push({
              id: nextId(seq),
              type: 'paragraph',
              content: `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" />`,
            });
          }
        }
        continue;
      }

      if (el.textContent?.trim()) {
        blocks.push({ id: nextId(seq), type: 'paragraph', content: el.innerHTML.trim() });
      }
    }
  };

  walk(root.childNodes);
  return blocks;
}

export function extractFeaturedImage(draft: unknown): FeaturedImageMeta | null {
  if (!draft || typeof draft !== 'object') return null;
  const fi = (draft as ManualDraftExtras).featured_image;
  if (!fi || typeof fi !== 'object') return null;
  const url = typeof fi.url === 'string' ? fi.url.trim() : '';
  if (!url) return null;
  return {
    url,
    alt: typeof fi.alt === 'string' ? fi.alt : undefined,
    path: typeof fi.path === 'string' ? fi.path : undefined,
  };
}

export function mergeDraftExtras(
  draft: WriterDraftPayloadLike,
  extras: Partial<ManualDraftExtras>
): WriterDraftPayloadLike {
  return { ...draft, ...extras };
}

export type WriterDraftPayloadLike = {
  seo_title: string;
  meta_title: string;
  meta_description: string;
  excerpt: string;
  blocks: DraftBlock[];
  featured_image?: FeaturedImageMeta | null;
  primary_keyword?: string;
  semantic_keywords?: string[];
};
