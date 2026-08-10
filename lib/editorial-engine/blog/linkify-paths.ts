/**
 * Site-wide bare-path linkification for blog/FAQ/tip prose.
 * Used by React blog UI and SSR HTML renderer so every publish gets working links.
 */

export const STATIC_PATH_LABELS: Record<string, string> = {
  '/': 'CityCost calculator',
  '/methodology': 'Methodology',
  '/data-sources': 'Data sources',
  '/about': 'About',
  '/disclaimer': 'Disclaimer',
  '/privacy': 'Privacy',
  '/terms': 'Terms',
  '/contact': 'Contact',
  '/blog': 'Blog',
};

/** City/country/compare/blog paths + authority pages + lone `/` (calculator). */
export const BARE_PATH_RE =
  /(\/(?:city|country|compare|blog)\/[a-z0-9][a-z0-9\-_/]*|\/(?:methodology|data-sources|about|disclaimer|privacy|terms|contact|blog)(?![a-z0-9\-_\/])|(?<![a-z0-9/])\/(?![a-z0-9]))/gi;

export function isValidSiteHref(href: string): boolean {
  const h = href.trim();
  if (!h) return false;
  if (h === '/') return true;
  if (h.startsWith('http://') || h.startsWith('https://') || h.startsWith('mailto:')) return true;
  return h.startsWith('/') && h.length >= 2;
}

function titleWords(words: string[]): string {
  return words
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function pathLinkLabel(href: string): string {
  const h = href.trim();
  if (STATIC_PATH_LABELS[h]) return STATIC_PATH_LABELS[h]!;
  const m = h.match(/^\/(city|country|compare|blog)\/(.+)$/i);
  if (m) {
    const kind = m[1]!.toLowerCase();
    const slug = m[2]!.replace(/\/+$/, '');
    const words = slug.split('-').filter(Boolean);
    if (kind === 'city' && words.length) {
      const trimmed = words.length > 1 ? words.slice(0, -1) : words;
      return titleWords(trimmed);
    }
    if (kind === 'country' && words.length) return titleWords(words);
    if (kind === 'compare' && words.length >= 2) {
      const mid = Math.max(1, Math.floor(words.length / 2));
      return `${titleWords(words.slice(0, mid))} vs ${titleWords(words.slice(mid))}`;
    }
    return titleWords(words);
  }
  return h;
}

export type PathPart = { type: 'text' | 'link'; value: string; href?: string };

/** Split plain text into text/link parts for React rendering. */
export function splitBarePaths(text: string): PathPart[] {
  if (!text) return [];
  const pathRe = new RegExp(BARE_PATH_RE.source, 'gi');
  const out: PathPart[] = [];
  let last = 0;
  let pm: RegExpExecArray | null;
  while ((pm = pathRe.exec(text)) !== null) {
    if (pm.index > last) out.push({ type: 'text', value: text.slice(last, pm.index) });
    let href = (pm[1] || pm[0] || '').trim().replace(/[.,;:!?)]+$/, '');
    if (isValidSiteHref(href)) {
      out.push({ type: 'link', value: pathLinkLabel(href), href });
    } else {
      out.push({ type: 'text', value: pm[0]! });
    }
    last = pm.index + pm[0]!.length;
  }
  if (last < text.length) out.push({ type: 'text', value: text.slice(last) });
  return out.length ? out : [{ type: 'text', value: text }];
}

/** Linkify bare paths inside already-escaped HTML (SSR). */
export function linkifyBarePathsInHtml(
  htmlEscaped: string,
  escapeAttr: (s: string) => string
): string {
  const pathRe = new RegExp(BARE_PATH_RE.source, 'gi');
  return htmlEscaped.replace(pathRe, (raw) => {
    const href = raw.replace(/[.,;:!?)]+$/, '');
    if (!isValidSiteHref(href)) return raw;
    const label = escapeAttr(pathLinkLabel(href));
    return `<a href="${escapeAttr(href)}" class="blog-inline-link">${label}</a>`;
  });
}
