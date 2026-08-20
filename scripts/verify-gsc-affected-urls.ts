/**
 * Search Console remediation check for the URLs reported under
 * "Alternate page with proper canonical tag".
 *
 * Each URL below was named in the GSC report. For every one this asserts the
 * full set of signals Google needs before the page can be indexed on its own:
 * status, indexability, a single self-referencing canonical, the correct
 * entity/country/currency, sitemap membership, structured data, internal links,
 * and — the reason they were folded together in the first place — cost data
 * that is genuinely distinct from the other affected pages.
 *
 * By default it runs against the local SSR renderer. Pass --base <origin> to run
 * the same assertions against a deployed server, e.g.
 *
 *   npx tsx scripts/verify-gsc-affected-urls.ts --base https://citycost.online
 *
 * Run: npx tsx scripts/verify-gsc-affected-urls.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { resolveSeoHtml } from '../lib/seo-ssr.js';
import { warmGeoCityIndex } from '../lib/geo-cities.js';
import { listIndexableCities, buildSitemapUrlEntries } from '../lib/seo-catalog.js';
import { SITE_URL } from '../src/utils/seo.js';

const baseIdx = process.argv.indexOf('--base');
const BASE = baseIdx > -1 ? String(process.argv[baseIdx + 1]).replace(/\/$/, '') : '';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/**
 * The URLs named in the Search Console report. Four further URLs are known to
 * exist in the report but have not been shared, so they are deliberately not
 * guessed at here — see the note printed at the end.
 */
const GSC_URLS: Array<{ path: string; entity: string; country: string; currency: string }> = [
  { path: '/country/uganda', entity: 'Uganda', country: 'Uganda', currency: 'UGX' },
  { path: '/city/san-jose-alajuela-province-costa-rica', entity: 'San José', country: 'Costa Rica', currency: 'CRC' },
  { path: '/city/setif-setif-algeria', entity: 'Sétif', country: 'Algeria', currency: 'DZD' },
  { path: '/city/warsaw-masovian-voivodeship-poland', entity: 'Warsaw', country: 'Poland', currency: 'PLN' },
  { path: '/city/bafata-bafata-guinea-bissau', entity: 'Bafatá', country: 'Guinea-Bissau', currency: 'XOF' },
  { path: '/city/sydney-new-south-wales-australia', entity: 'Sydney', country: 'Australia', currency: 'AUD' },
  { path: '/city/queenstown-otago-region-new-zealand', entity: 'Queenstown', country: 'New Zealand', currency: 'NZD' },
  { path: '/city/bechar-bechar-algeria', entity: 'Béchar', country: 'Algeria', currency: 'DZD' },
  { path: '/city/bangkok-bangkok-thailand', entity: 'Bangkok', country: 'Thailand', currency: 'THB' },
  { path: '/city/zug-zug-switzerland', entity: 'Zug', country: 'Switzerland', currency: 'CHF' },
];

interface Page {
  status: number;
  location: string;
  html: string;
}

let template = '';

async function fetchPage(p: string): Promise<Page> {
  if (BASE) {
    const res = await fetch(`${BASE}${p}`, { redirect: 'manual' });
    return {
      status: res.status,
      location: res.headers.get('location') || '',
      html: res.status === 200 ? await res.text() : '',
    };
  }
  const r = resolveSeoHtml(template, p);
  if (r.status !== 200) {
    return { status: r.status, location: 'location' in r ? r.location : '', html: '' };
  }
  return { status: 200, location: '', html: r.html };
}

function canonicals(html: string): string[] {
  return (html.match(/<link rel="canonical" href="([^"]+)"/gi) || []).map(
    (t) => t.match(/href="([^"]+)"/i)?.[1] || ''
  );
}

function metric(html: string, label: string): string {
  const m = html.match(new RegExp(`<li>${label}[^<]*?:\\s*([^<]*)</li>`, 'i'));
  return (m?.[1] || '').trim();
}

async function main(): Promise<void> {
  if (!BASE) {
    warmGeoCityIndex();
    template = fs.readFileSync(path.resolve('index.html'), 'utf-8');
  }
  console.log(`\nGSC affected URLs — target: ${BASE || 'local SSR renderer'}\n`);

  const sitemap = new Set([
    ...buildSitemapUrlEntries().cities,
    ...buildSitemapUrlEntries().countries,
  ]);
  const cities = listIndexableCities();
  const costFingerprints = new Map<string, string[]>();

  for (const target of GSC_URLS) {
    console.log(`${target.path}`);
    const page = await fetchPage(target.path);

    if (page.status !== 200) {
      check(`${target.path} returns 200`, false, `status ${page.status} -> ${page.location}`);
      continue;
    }
    check(`${target.path} returns 200`, true);

    const tags = canonicals(page.html);
    check('  exactly one canonical tag', tags.length === 1, `${tags.length} tags`);
    check(
      '  canonical is self-referencing',
      tags[0] === `${SITE_URL}${target.path}`,
      `${tags[0]} != ${SITE_URL}${target.path}`
    );

    const robots = page.html.match(/<meta name="robots" content="([^"]*)"/i)?.[1] || '';
    check('  indexable (index, follow)', /^index,\s*follow/.test(robots), robots || '(missing)');
    check('  no noindex anywhere on the page', !/noindex/i.test(page.html));

    const title = page.html.match(/<title>([^<]*)<\/title>/i)?.[1] || '';
    const h1 = (page.html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '').replace(/<[^>]*>/g, '').trim();
    check(
      `  entity is ${target.entity}`,
      title.includes(target.entity) && h1.includes(target.entity),
      `title="${title}" h1="${h1}"`
    );

    check('  in the sitemap', sitemap.has(`${SITE_URL}${target.path}`));

    // The tags carry attributes (data-schema="..."), so match the type only.
    const ldBlocks = page.html.match(
      /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi
    ) || [];
    check('  has JSON-LD structured data', ldBlocks.length > 0, `${ldBlocks.length} blocks`);
    const ldTypes = ldBlocks
      .map((b) => b.replace(/<[^>]*>/g, ''))
      .flatMap((raw) => {
        try {
          const parsed = JSON.parse(raw);
          return (Array.isArray(parsed) ? parsed : [parsed]).map(
            (o: { '@type'?: string }) => o['@type'] || ''
          );
        } catch {
          return ['<invalid json>'];
        }
      });
    check('  all JSON-LD blocks parse as valid JSON', !ldTypes.includes('<invalid json>'));
    check(
      '  JSON-LD describes the page, not just the site',
      ldTypes.some((t) => t && !['Organization', 'WebSite'].includes(t)),
      ldTypes.join(', ')
    );
    check('  links to /methodology and /data-sources',
      page.html.includes('/methodology') && page.html.includes('/data-sources'));

    if (target.path.startsWith('/city/')) {
      check(
        `  country is ${target.country}`,
        page.html.includes(`>${target.country}</a>`),
        'country link not found'
      );
      const cur = metric(page.html, 'Currency');
      check(`  currency is ${target.currency}`, cur === target.currency, cur || '(not found)');

      const cpi = metric(page.html, 'Cost of living index \\(CPI\\)');
      const rent = metric(page.html, 'Rent index');
      const ppi = metric(page.html, 'Purchasing power index');
      check('  cost data present', Boolean(cpi && rent && ppi), `${cpi}/${rent}/${ppi}`);
      const fp = `${cpi}|${rent}|${ppi}|${cur}`;
      const bucket = costFingerprints.get(fp);
      if (bucket) bucket.push(target.path);
      else costFingerprints.set(fp, [target.path]);

      const slug = target.path.replace('/city/', '');
      const rec = cities.find((c) => c.pageSlug === slug);
      check('  present in the indexable city set', Boolean(rec));
      const internal = (page.html.match(/href="\/(city|country|compare|rent)\//g) || []).length;
      check('  has internal links to related pages', internal >= 3, `${internal} links`);
    }
    console.log('');
  }

  console.log('Cross-page differentiation (the duplicate-cluster cause)');
  const collisions = [...costFingerprints.entries()].filter(([, v]) => v.length > 1);
  check(
    'no two affected city pages share a cost fingerprint',
    collisions.length === 0,
    collisions.map(([k, v]) => `${v.join(' == ')} (${k})`).join('; ')
  );

  console.log(
    `\nNote: the report also contains 4 URLs that have not been shared. They are ` +
      `deliberately not guessed here — add them to GSC_URLS when identified.`
  );
  console.log(
    failures === 0 ? '\nAll GSC affected URLs verified.\n' : `\n${failures} check(s) FAILED.\n`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
