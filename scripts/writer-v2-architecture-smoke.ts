/**
 * Writer Engine v2 architecture smoke tests (no AI calls).
 * Run: npx tsx scripts/writer-v2-architecture-smoke.ts
 */

import { buildEditorialPlan } from '../lib/editorial-engine/writer/v2/editorial-brain.js';
import { routeGuideId } from '../lib/editorial-engine/writer/v2/guide-router.js';
import { getGuideSectionWriter, listGuideSectionWriterIds } from '../lib/editorial-engine/writer/v2/sections/registry.js';
import { detectPersona, listPersonas } from '../lib/editorial-engine/writer/v2/persona/engine.js';
import { selectStyle } from '../lib/editorial-engine/writer/v2/style/library.js';
import { generateDynamicOutline } from '../lib/editorial-engine/writer/v2/outlines/dynamic-outline-generator.js';
import { WRITER_ENGINE_VERSION } from '../lib/editorial-engine/constants.js';
import type { GuideId } from '../lib/editorial-engine/writer/v2/types.js';

const GUIDES: GuideId[] = [
  'country',
  'city',
  'comparison',
  'salary',
  'rent',
  'food',
  'healthcare',
  'student',
  'visa',
  'moving',
  'retirement',
  'budget',
  'remote',
  'travel',
  'tax',
];

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

async function main() {
  console.log(`Writer Engine ${WRITER_ENGINE_VERSION} architecture smoke`);

  assert(WRITER_ENGINE_VERSION === '5.0.0', 'version must be 5.0.0');
  assert(listPersonas().length >= 15, 'persona catalog too small');

  // Guide-specific section writers must never share ids across guides
  const allIds = new Set<string>();
  for (const g of GUIDES) {
    const ids = listGuideSectionWriterIds(g);
    assert(ids.length > 0, `no section writers for ${g}`);
    for (const id of ids) {
      assert(id.startsWith(`${g}.`), `writer id must be namespaced: ${id}`);
      assert(!allIds.has(id), `duplicate cross-guide writer id: ${id}`);
      allIds.add(id);
      const key = id.split('.')[1] as Parameters<typeof getGuideSectionWriter>[1];
      const w = getGuideSectionWriter(g, key);
      assert(w.guide_id === g, `guide mismatch ${w.id}`);
      assert(w.id === id, `id mismatch ${w.id}`);
    }
  }
  console.log(`✓ ${allIds.size} unique guide-specific section writers`);

  // Dynamic outlines differ by topic for same guide
  const persona = detectPersona({ title: 'Cost of living in India for families' });
  const style = selectStyle({ guide_id: 'country', persona_id: persona.id });
  const india = generateDynamicOutline({
    guide_id: 'country',
    persona,
    style,
    title: 'Cost of living in India for families',
    keyword: 'cost of living india',
    researchDigest: 'rent housing schools education healthcare tax regional cities salary budget',
    depth: 'standard',
    entities: { country: 'India' },
  });
  const japan = generateDynamicOutline({
    guide_id: 'country',
    persona: detectPersona({ title: 'Remote work cost of living in Japan' }),
    style: selectStyle({ guide_id: 'country', persona_id: 'remote_worker' }),
    title: 'Remote work cost of living in Japan',
    keyword: 'japan remote work',
    researchDigest: 'remote internet visa housing transport culture healthcare',
    depth: 'standard',
    entities: { country: 'Japan' },
  });
  const indiaKeys = india.map((s) => s.key).join(',');
  const japanKeys = japan.map((s) => s.key).join(',');
  assert(india.length >= 6 && japan.length >= 6, 'outlines too short');
  console.log(`✓ India outline: ${indiaKeys}`);
  console.log(`✓ Japan outline: ${japanKeys}`);
  assert(indiaKeys !== japanKeys, 'dynamic outlines should differ by topic');

  // Brain routing
  assert(routeGuideId('country_guide') === 'country', 'country route');
  assert(routeGuideId('comparison_guide') === 'comparison', 'comparison route');
  assert(routeGuideId(null, 'Tokyo vs Osaka cost of living') === 'comparison', 'title compare route');

  const plan = buildEditorialPlan({
    topic: {
      title: 'Planning a Move to India? A Clear Cost of Living Breakdown',
      content_type: 'country_guide',
      persona: 'family',
      primary_keyword: 'cost of living in India',
      country: 'India',
    },
    research: { required_h2: ['SHOULD_BE_IGNORED'] },
  });
  assert(plan.guide_id === 'country', 'brain guide');
  assert(plan.outline.every((s) => s.heading !== 'SHOULD_BE_IGNORED'), 'must ignore research required_h2');
  assert(plan.persona.id === 'family_with_children' || plan.persona.confidence > 0, 'persona');
  console.log(
    `✓ Brain plan guide=${plan.guide_id} persona=${plan.persona.id} style=${plan.style.id} sections=${plan.outline.length}`
  );

  console.log('OK — Writer v2 architecture smoke passed');
}

main().catch((err) => {
  console.error('FAIL', err);
  process.exit(1);
});
