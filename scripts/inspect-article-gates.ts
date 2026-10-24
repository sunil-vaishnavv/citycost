/**
 * READ-ONLY: run the blocking publication content gates against a saved article.
 * Never writes to any database.
 *
 *   npx tsx scripts/inspect-article-gates.ts 117 --json .tools/article-117.json
 *   npx tsx scripts/inspect-article-gates.ts 117          (uses READONLY_DATABASE_URL, READ ONLY txn)
 *
 * The JSON file may be either the article row, or the admin API response
 * ({ article: {...} }), as long as it has draft_json / blocks_json and research_pack_json.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import type { WriterDraftPayload } from '../lib/editorial-engine/writer/draft-validate.js';
import { validateWriterDraft } from '../lib/editorial-engine/writer/draft-validate.js';
import { inspectPublicIntegrity, repairPublicIntegrity } from '../lib/editorial-engine/writer/v2/public-integrity-gate.js';
import { inspectRenderedArticleHtml } from '../lib/editorial-engine/blog/rendered-html-check.js';
import { linkFloorForResearch, type LinkResearchLike } from '../lib/editorial-engine/writer/v2/link-relevance.js';
import { toPublicTitle } from '../lib/editorial-engine/utils/clean-title.js';
import type { CalculationLedger } from '../lib/editorial-engine/research/comparison-ledger.js';

type Row = Record<string, unknown>;

async function loadFromDb(id: number): Promise<Row | null> {
  const url = process.env.READONLY_DATABASE_URL;
  if (!url) throw new Error('READONLY_DATABASE_URL is not set (or pass --json <file>)');
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 10000 });
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const r = await client.query(
      'SELECT id, slug, status, seo_title, prompt_hash, ai_model, draft_json, blocks_json, research_pack_json, meta_title, meta_description, excerpt FROM editorial_articles WHERE id = $1',
      [id]
    );
    await client.query('ROLLBACK');
    return r.rows[0] || null;
  } finally {
    await client.end();
  }
}

function asDraft(row: Row): WriterDraftPayload {
  const d = row.draft_json as WriterDraftPayload | null;
  if (d && Array.isArray(d.blocks)) return d;
  return {
    seo_title: String(row.seo_title || ''),
    meta_title: String(row.meta_title || ''),
    meta_description: String(row.meta_description || ''),
    excerpt: String(row.excerpt || ''),
    blocks: (row.blocks_json as WriterDraftPayload['blocks']) || [],
  };
}

async function main() {
  const id = Number(process.argv[2]);
  const jsonIdx = process.argv.indexOf('--json');
  let row: Row | null;
  if (jsonIdx > 0) {
    const raw = JSON.parse(readFileSync(process.argv[jsonIdx + 1]!, 'utf8')) as Row;
    row = (raw.article as Row) || raw;
  } else {
    row = await loadFromDb(id);
  }
  if (!row) throw new Error(`Article ${id} not found`);
  const draft = asDraft(row);
  const research = (row.research_pack_json || null) as (LinkResearchLike & {
    geo_scope?: { country_codes: string[]; city_page_slugs: string[] };
    calculation_ledger?: CalculationLedger;
    research_status?: string;
  }) | null;
  const ctx = {
    articleTitle: toPublicTitle(String(row.seo_title || draft.seo_title || '')),
    scope: research?.geo_scope || null,
    ledger: research?.calculation_ledger || null,
    researchStatus: research?.research_status || null,
  };

  console.log(`Article #${row.id ?? id} "${draft.seo_title}" status=${row.status} research_status=${research?.research_status ?? 'n/a'} geo=${JSON.stringify(research?.geo_scope ?? null)}`);
  const integrity = inspectPublicIntegrity(draft, ctx);
  const rendered = inspectRenderedArticleHtml(draft);
  const content = validateWriterDraft(draft, { min: 0, max: 100000 }, null, {
    min_internal_links: linkFloorForResearch(research),
  });
  const blocking = [
    ...integrity.errors.map((e) => `public_integrity/${e.code}: ${e.message}`),
    ...rendered.map((f) => `rendered_html/${f.code}: ${f.message}`),
    ...content.errors.filter((e) => !/Word count/.test(e)).map((e) => `content_validation: ${e}`),
  ];
  console.log(`\nBLOCKING (${blocking.length}):`);
  for (const b of blocking) console.log(`  ✗ ${b}`);
  console.log(`\nWARNINGS (${integrity.warnings.length}):`);
  for (const w of integrity.warnings) console.log(`  ! ${w.code}: ${w.message}`);

  const repaired = repairPublicIntegrity(draft, ctx);
  const after = inspectPublicIntegrity(repaired.draft, ctx);
  console.log(`\nIf re-saved through the pipeline (no write performed): fixes=${repaired.fixes.join(', ') || 'none'}`);
  console.log(`  residual blocking after mechanical repair: ${after.errors.length}`);
  for (const e of after.errors) console.log(`  ✗ ${e.code}: ${e.message}`);
  console.log(`\nRESULT: ${blocking.length ? 'FAILS blocking content gates' : 'passes blocking content gates'} (status/quality-review/SEO/schema checks need the live publish gate)`);
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
