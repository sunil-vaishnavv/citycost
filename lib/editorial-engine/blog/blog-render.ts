/**
 * Render structured article blocks to SSR HTML + inject internal links.
 */

import type { WriterDraftPayload, DraftBlock } from '../writer/draft-validate.js';
import type { InternalLinkRecommendation } from '../seo/internal-links.js';
import { isValidSiteHref } from './linkify-paths.js';
import { blockContentText } from '../reviewer/text-utils.js';
import { linkifyBarePathsInHtml } from './linkify-paths.js';
import {
  containsHtml,
  sanitizeRichHtml,
  blockHeadingLevel,
  blockHeadingText,
  listItemsFromContent,
} from '../manual/html-blocks.js';

function esc(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderInlineWithLinks(
  text: string,
  links: InternalLinkRecommendation[],
  used: Set<string>
): string {
  const mdRe = /\[([^\]]+)\]\(([^)]+)\)/g;
  const segments: Array<
    { kind: 'text'; value: string } | { kind: 'link'; label: string; href: string }
  > = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = mdRe.exec(text)) !== null) {
    if (m.index > last) segments.push({ kind: 'text', value: text.slice(last, m.index) });
    const label = m[1]!.trim();
    const href = m[2]!.trim();
    if (label && isValidSiteHref(href)) {
      segments.push({ kind: 'link', label, href });
      used.add(href);
    } else {
      segments.push({ kind: 'text', value: m[0]! });
    }
    last = m.index + m[0]!.length;
  }
  if (last < text.length) segments.push({ kind: 'text', value: text.slice(last) });
  if (!segments.length) segments.push({ kind: 'text', value: text });

  const ordered = [...links].sort((a, b) => b.anchor.length - a.anchor.length);

  const renderTextChunk = (chunk: string): string => {
    let html = esc(chunk);
    for (const link of ordered) {
      if (used.has(link.target)) continue;
      const anchor = link.anchor.trim();
      if (anchor.length < 3) continue;
      const rawIdx = chunk.toLowerCase().indexOf(anchor.toLowerCase());
      if (rawIdx === -1) continue;
      const actual = chunk.slice(rawIdx, rawIdx + anchor.length);
      const needle = esc(actual);
      const pos = html.indexOf(needle);
      if (pos === -1) continue;
      const a = `<a href="${esc(link.target)}" class="blog-inline-link">${needle}</a>`;
      html = html.slice(0, pos) + a + html.slice(pos + needle.length);
      used.add(link.target);
    }
    return linkifyBarePathsInHtml(html, esc);
  };

  return segments
    .map((seg) =>
      seg.kind === 'link'
        ? `<a href="${esc(seg.href)}" class="blog-inline-link">${esc(seg.label)}</a>`
        : renderTextChunk(seg.value)
    )
    .join('');
}

function renderFaq(
  content: unknown,
  links: InternalLinkRecommendation[],
  used: Set<string>
): string {
  if (!Array.isArray(content)) {
    return `<p>${renderInlineWithLinks(String(content || ''), links, used)}</p>`;
  }
  return content
    .map((item) => {
      if (!item || typeof item !== 'object') return '';
      const q = String(
        (item as { q?: string; question?: string }).q ||
          (item as { question?: string }).question ||
          ''
      );
      const a = String(
        (item as { a?: string; answer?: string }).a ||
          (item as { answer?: string }).answer ||
          ''
      );
      if (!q || !a) return '';
      return `<div class="blog-faq-item"><h3>${esc(q)}</h3><p>${renderInlineWithLinks(a, links, used)}</p></div>`;
    })
    .join('\n');
}

function renderList(
  content: unknown,
  links: InternalLinkRecommendation[],
  used: Set<string>
): string {
  const { items, ordered } = listItemsFromContent(content);
  if (!items.length) {
    if (typeof content === 'string' && content.trim()) {
      return `<p>${renderInlineWithLinks(content, links, used)}</p>`;
    }
    return '';
  }
  const tag = ordered ? 'ol' : 'ul';
  const lis = items
    .map((item) => {
      const inner = containsHtml(item)
        ? sanitizeRichHtml(item)
        : renderInlineWithLinks(item, links, used);
      return `<li>${inner}</li>`;
    })
    .join('');
  return `<${tag}>${lis}</${tag}>`;
}

function renderTableCell(cell: string): string {
  if (containsHtml(cell)) return sanitizeRichHtml(cell);
  return esc(cell);
}

function renderTable(content: unknown): string {
  if (!content || typeof content !== 'object') return `<p>${esc(String(content || ''))}</p>`;
  const obj = content as { headers?: string[]; rows?: unknown[]; columns?: string[] };
  const rows = Array.isArray(obj.rows) ? obj.rows : null;
  if (!rows?.length) {
    if (Array.isArray(content)) {
      return renderTable({ rows: content });
    }
    return `<pre>${esc(JSON.stringify(content, null, 2))}</pre>`;
  }
  const normalized = rows.map((r) =>
    Array.isArray(r)
      ? r.map((c) => String(c ?? ''))
      : r && typeof r === 'object'
        ? Object.values(r as Record<string, unknown>).map((c) => String(c ?? ''))
        : [String(r)]
  );
  const colCount = Math.max(...normalized.map((r) => r.length), 1);
  const headers =
    Array.isArray(obj.headers) && obj.headers.length
      ? obj.headers.map(String)
      : Array.isArray(obj.columns) && obj.columns.length
        ? obj.columns.map(String)
        : null;
  const head = headers
    ? `<thead><tr>${headers
        .slice(0, colCount)
        .map((h) => `<th>${renderTableCell(h)}</th>`)
        .join('')}</tr></thead>`
    : '';
  const body = normalized
    .map(
      (r) =>
        `<tr>${Array.from({ length: colCount }, (_, i) => `<td>${renderTableCell(r[i] ?? '')}</td>`).join(
          ''
        )}</tr>`
    )
    .join('');
  return `<div class="blog-table-wrap"><table>${head}<tbody>${body}</tbody></table></div>`;
}

const HEADED_RENDER_TYPES = new Set(['paragraph', 'list', 'comparison', 'table', 'faq', 'summary', 'tip', 'warning']);
const TOC_HEADING = /^(?:table of contents|contents)$/i;

/** The stored TOC block (rendered once from real headings instead). */
function isStoredTocBlock(block: DraftBlock): boolean {
  return block.id === 'toc' || TOC_HEADING.test((block.heading || '').trim());
}

/**
 * Section heading a block renders, or null. Shared by buildTocHtml and the
 * renderer so every TOC anchor (#section-N) points at a real heading.
 */
function sectionHeadingLabel(block: DraftBlock): string | null {
  if (isStoredTocBlock(block) || block.type === 'intro') return null;
  if (block.type === 'heading') {
    const label = blockHeadingText(block);
    return label && !TOC_HEADING.test(label.trim()) ? label : null;
  }
  const heading = (block.heading || '').trim();
  return heading && HEADED_RENDER_TYPES.has(block.type) ? heading : null;
}

export function buildTocHtml(blocks: DraftBlock[]): string {
  // Same numbering as renderArticleBlocksHtml (every rendered heading gets section-N),
  // but only H2 sections are listed — matching the public page and the stored TOC.
  const entries: Array<{ id: string; label: string }> = [];
  let index = 0;
  for (const b of blocks) {
    const label = sectionHeadingLabel(b);
    if (!label) continue;
    index += 1;
    if (b.type === 'heading' && blockHeadingLevel(b) >= 3) continue;
    entries.push({ id: `section-${index}`, label });
  }
  if (!entries.length) return '';
  const items = entries.map((e) => `<li><a href="#${e.id}">${esc(e.label)}</a></li>`).join('');
  return `<nav class="blog-toc" aria-label="Table of contents"><h2>Table of contents</h2><ol>${items}</ol></nav>`;
}

export function renderArticleBlocksHtml(
  draft: WriterDraftPayload,
  links: InternalLinkRecommendation[] = []
): string {
  const used = new Set<string>();
  const blocks = draft.blocks || [];
  let headingIndex = 0;
  const parts: string[] = [];

  for (const block of blocks) {
    // Stored TOC is replaced by the generated one. (A list that merely mentions
    // "contents", e.g. contents insurance, is ordinary content and must render.)
    if (isStoredTocBlock(block)) continue;

    const label = sectionHeadingLabel(block);
    if (block.type === 'heading') {
      if (label) {
        headingIndex += 1;
        const level = blockHeadingLevel(block);
        parts.push(
          `<h${level} id="section-${headingIndex}">${renderInlineWithLinks(label, links, used)}</h${level}>`
        );
      }
      continue;
    }

    if (label) {
      headingIndex += 1;
      parts.push(`<h2 id="section-${headingIndex}">${esc(label)}</h2>`);
    }

    switch (block.type) {
      case 'intro':
      case 'paragraph':
      case 'summary': {
        const raw =
          typeof block.content === 'string' ? block.content : blockContentText(block);
        if (containsHtml(raw)) {
          parts.push(
            `<div class="blog-p blog-${block.type} blog-rich">${sanitizeRichHtml(raw)}</div>`
          );
        } else {
          parts.push(
            `<p class="blog-p blog-${block.type}">${renderInlineWithLinks(raw, links, used)}</p>`
          );
        }
        break;
      }
      case 'tip':
        parts.push(
          `<aside class="blog-tip"><strong>Tip:</strong> ${renderInlineWithLinks(blockContentText(block), links, used)}</aside>`
        );
        break;
      case 'warning':
        parts.push(
          `<aside class="blog-warning"><strong>Note:</strong> ${renderInlineWithLinks(blockContentText(block), links, used)}</aside>`
        );
        break;
      case 'list':
        parts.push(renderList(block.content, links, used));
        break;
      case 'table':
      case 'comparison':
        parts.push(renderTable(block.content));
        break;
      case 'faq':
        parts.push(
          `<section class="blog-faq"><h2>FAQ</h2>${renderFaq(block.content, links, used)}</section>`
        );
        break;
      default:
        parts.push(`<p>${renderInlineWithLinks(blockContentText(block), links, used)}</p>`);
    }
  }

  const toc = buildTocHtml(blocks);
  return `${toc}\n${parts.join('\n')}`;
}

export function renderRelatedLinksHtml(input: {
  links: InternalLinkRecommendation[];
  relatedArticles?: Array<{ slug: string; title: string }>;
}): string {
  const groups: Record<string, InternalLinkRecommendation[]> = {};
  for (const l of input.links) {
    (groups[l.link_kind] ||= []).push(l);
  }
  const sections: string[] = [];
  const order = ['comparison', 'city', 'country', 'calculator', 'blog', 'authority'] as const;
  const labels: Record<string, string> = {
    comparison: 'Related comparisons',
    city: 'Related cities',
    country: 'Related countries',
    calculator: 'Tools',
    blog: 'Related guides',
    authority: 'About our data',
  };
  for (const kind of order) {
    const items = groups[kind];
    if (!items?.length) continue;
    const lis = items
      .slice(0, 6)
      .map((l) => `<li><a href="${esc(l.target)}">${esc(l.anchor)}</a></li>`)
      .join('');
    sections.push(`<div class="blog-related-group"><h3>${labels[kind]}</h3><ul>${lis}</ul></div>`);
  }
  if (input.relatedArticles?.length) {
    const lis = input.relatedArticles
      .map((a) => `<li><a href="/blog/${esc(a.slug)}">${esc(a.title)}</a></li>`)
      .join('');
    sections.push(`<div class="blog-related-group"><h3>More guides</h3><ul>${lis}</ul></div>`);
  }
  if (!sections.length) return '';
  return `<section class="blog-related"><h2>Explore CityCost</h2>${sections.join('\n')}</section>`;
}
