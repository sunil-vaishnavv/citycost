/**
 * Page-level EEAT copy helpers — derived only from existing authority/content data.
 * No fake reviews, ratings, authors, or invented providers.
 */

import { DATA_SOURCES, AUTHORITY_PAGES } from './pages.js';

/** Organization-level attribution for public knowledge pages (not a fictional person). */
export const CONTENT_AUTHOR = {
  name: 'CityCost Global',
  role: 'Research & publishing',
  href: '/about',
} as const;

export function getContentAuthorLabel(): string {
  return `${CONTENT_AUTHOR.name} — ${CONTENT_AUTHOR.role}`;
}

/** Active sources from DATA_SOURCES (excludes roadmap "future"). */
export function listActiveDataSourceNames(): string[] {
  return DATA_SOURCES.filter((s) => s.id !== 'future').map((s) => s.name);
}

/**
 * Short methodology explanation from the published /methodology page.
 * Do not invent formulas — excerpt existing copy only.
 */
export function getShortMethodologyText(): string {
  const section = AUTHORITY_PAGES.methodology.sections.find((s) => s.id === 'how-calculated');
  const p = section?.paragraphs?.[0];
  if (p) return p;
  return AUTHORITY_PAGES.methodology.intro;
}

export function normalizeIsoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

/** Prefer content-engine meta dates; never invent a marketing date. */
export function resolvePageLastUpdated(
  ...candidates: Array<string | null | undefined>
): string | null {
  for (const c of candidates) {
    const n = normalizeIsoDate(c);
    if (n) return n;
  }
  return null;
}

/**
 * SSR trust HTML block (Last Updated + Data Sources + Methodology).
 * Skips empty optional fields; links to authority pages.
 */
export function buildTrustBlockHtml(input: {
  lastUpdated?: string | null;
  pageSources?: string[];
  escText: (s: string) => string;
}): string {
  const last = normalizeIsoDate(input.lastUpdated);
  const active = listActiveDataSourceNames();
  const pageSources = (input.pageSources || []).filter(Boolean);
  const method = getShortMethodologyText();
  const sourceLines = pageSources.length
    ? pageSources.map((s) => `<li>${input.escText(s)}</li>`).join('')
    : active.map((s) => `<li>${input.escText(s)}</li>`).join('');

  return `<section id="eeat-trust">
  <h2>Trust &amp; data transparency</h2>
  ${last ? `<p><strong>Last updated:</strong> ${input.escText(last)}</p>` : ''}
  <h3>Data Sources</h3>
  <p>This page uses CityCost index inputs. Platform sources (see also <a href="/data-sources">Data sources</a>):</p>
  <ul>${sourceLines}</ul>
  ${
    pageSources.length
      ? `<p>On-page labels for this view: ${input.escText(pageSources.join(' · '))}.</p>`
      : ''
  }
  <h3>Methodology</h3>
  <p>${input.escText(method)}</p>
  <p><a href="/methodology">Read full methodology</a> · <a href="/data-sources">Data sources</a> · <a href="/disclaimer">Disclaimer</a></p>
</section>`;
}
