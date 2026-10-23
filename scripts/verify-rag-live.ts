/**
 * LIVE check of Google Search grounding (makes one real, billed Gemini call).
 * Confirms the API key and model work and that facts come back with real sources.
 *
 * Usage: npx tsx scripts/verify-rag-live.ts [targetCity] [comparisonCity]
 *   e.g. npx tsx scripts/verify-rag-live.ts Berlin Munich
 * Requires GEMINI_API_KEY (optional RAG_GEMINI_MODEL) in .env.
 */
import 'dotenv/config';
import { getRagModel, retrieveGroundedCityCostData } from '../lib/editorial-engine/rag/index.js';

async function main() {
  const [targetCity = 'Berlin', comparisonCity] = process.argv.slice(2);
  if (!process.env.GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY is not set — add it to .env to run the live check.');
    process.exit(2);
  }
  console.log(`Live grounding: ${targetCity}${comparisonCity ? ` vs ${comparisonCity}` : ''} · model=${getRagModel()}`);
  const started = Date.now();
  const r = await retrieveGroundedCityCostData({ targetCity, comparisonCity });
  console.log(`status=${r.status} in ${((Date.now() - started) / 1000).toFixed(1)}s${r.error ? ` · ${r.error}` : ''}`);
  console.log(`sources=${r.sources.length} facts=${r.facts.length} dropped_unsourced=${r.unsupportedDropped}`);
  for (const s of r.sources) console.log(`  [^${s.id}] ${s.domain} — ${s.title}`);
  for (const f of r.facts) console.log(`  ${f.citationRef} (${f.city ?? 'both/unspecified'}) ${f.statement}`);
  if (r.status !== 'live') process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
