/**
 * Checks on the FINAL rendered article HTML (the same renderer public SSR uses),
 * so defects that only appear after rendering are caught, not just block data.
 */

import type { WriterDraftPayload } from '../writer/draft-validate.js';
import { buildTocHtml, renderArticleBlocksHtml } from './blog-render.js';
import { PLACEHOLDER_HOST_RE } from '../writer/v2/link-normalize.js';
import { findDirectiveLeaks } from '../writer/v2/public-content-quality.js';
import { isIncompleteHeading } from '../writer/v2/heading-integrity.js';

export interface RenderedHtmlFinding {
  code:
    | 'toc_anchor_unresolved'
    | 'toc_order_mismatch'
    | 'placeholder_url'
    | 'incomplete_heading'
    | 'directive_leak'
    | 'empty_toc';
  message: string;
}

function decode(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function renderArticleHtml(draft: WriterDraftPayload): { toc: string; body: string } {
  return { toc: buildTocHtml(draft.blocks || []), body: renderArticleBlocksHtml(draft) };
}

export function inspectRenderedArticleHtml(draft: WriterDraftPayload): RenderedHtmlFinding[] {
  const findings: RenderedHtmlFinding[] = [];
  const { toc, body } = renderArticleHtml(draft);
  const html = `${toc}\n${body}`;

  const headingIds: string[] = [];
  const headingTexts: Array<{ id: string; text: string }> = [];
  for (const m of body.matchAll(/<h([2-4])\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/h\1>/g)) {
    headingIds.push(m[2]!);
    headingTexts.push({ id: m[2]!, text: decode(m[3]!).trim() });
  }
  const tocLinks = [...toc.matchAll(/<a href="#([^"]+)">([\s\S]*?)<\/a>/g)].map((m) => ({ id: m[1]!, label: decode(m[2]!) }));
  if (headingIds.length >= 2 && !tocLinks.length) findings.push({ code: 'empty_toc', message: 'Article has sections but no TOC entries' });
  for (const l of tocLinks) {
    if (!headingIds.includes(l.id)) findings.push({ code: 'toc_anchor_unresolved', message: `TOC link #${l.id} ("${l.label}") has no matching heading` });
  }
  const order = tocLinks.map((l) => headingIds.indexOf(l.id)).filter((i) => i >= 0);
  if (order.some((v, i) => i > 0 && v < order[i - 1]!)) {
    findings.push({ code: 'toc_order_mismatch', message: 'TOC order differs from the rendered heading order' });
  }
  for (const h of headingTexts) {
    if (isIncompleteHeading(h.text)) findings.push({ code: 'incomplete_heading', message: `Rendered heading is incomplete: "${h.text}"` });
  }
  for (const m of html.matchAll(/href="([^"]+)"/g)) {
    const href = m[1]!;
    if (!/^https?:\/\//i.test(href)) continue;
    try {
      if (PLACEHOLDER_HOST_RE.test(new URL(href).hostname)) {
        findings.push({ code: 'placeholder_url', message: `Rendered link points to a placeholder host: ${href}` });
      }
    } catch {
      /* ignore */
    }
  }
  const text = decode(body.replace(/<\/(p|li|h\d|div|td|th)>/g, '. '));
  for (const m of text.matchAll(/https?:\/\/(?:www\.)?example\.(?:com|org|net)\S*/gi)) {
    findings.push({ code: 'placeholder_url', message: `Placeholder URL in rendered text: ${m[0]}` });
  }
  for (const leak of findDirectiveLeaks(text)) {
    findings.push({ code: 'directive_leak', message: `Rendered text contains an instruction: "${leak}"` });
  }
  return findings;
}
