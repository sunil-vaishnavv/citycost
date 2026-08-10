import { runEditorialStrategy } from '../lib/editorial-engine/strategy/strategy-engine.js';

async function main() {
  const r = await runEditorialStrategy({
    maxCandidates: 2,
    maxCountries: 40,
    detect_gaps: false,
  });
  console.log(
    JSON.stringify(
      {
        ok: r.ok,
        considered: r.candidates_considered,
        upserted: r.topics_upserted,
        rejected: r.topics_rejected,
        skipped: r.topics_skipped,
        pruned: r.topics_pruned,
        byType: r.distribution_by_type,
        byCountry: Object.fromEntries(
          Object.entries(r.distribution_by_country)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 15)
        ),
        top10: r.top.slice(0, 10),
        bottom5: r.bottom.slice(0, 5),
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
