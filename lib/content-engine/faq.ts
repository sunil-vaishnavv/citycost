/**
 * Dynamic FAQ engine — city / country / compare.
 * Questions are parameterized by place names and verified numbers only.
 */

import type { CityKnowledge, CountryKnowledge, CompareKnowledge, FaqItem } from './types.js';
import { fmtMoney, fmtNum, locLabel } from './templates.js';

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Rotate FAQ set so pages don't share identical Q templates. */
function rotate<T>(items: T[], seed: string): T[] {
  if (items.length <= 1) return items;
  const offset = hash(seed) % items.length;
  return [...items.slice(offset), ...items.slice(0, offset)];
}

export function generateCityFaqs(k: CityKnowledge): FaqItem[] {
  const loc = locLabel(k.city, k.state, k.country);
  const rent = fmtMoney(k.symbol, k.prices.rent_1br, k.currency);
  const salary = fmtMoney(k.symbol, k.prices.salary, k.currency);
  const cpi = fmtNum(k.indices.cpi);
  const nearby = k.nearby_cities.slice(0, 3).map((n) => n.city);
  const peer = nearby[0] || k.related_comparisons[0]?.label.split(' vs ')[1] || null;

  const pool: FaqItem[] = [
    {
      q: `Is ${k.city} expensive?`,
      a: cpi
        ? `${loc} has a CPI of ${cpi} (NYC=100). Whether that feels expensive depends on your income${salary ? ` (reference net salary ~${salary})` : ''} and whether housing tracks the rent index or a premium micro-market.`
        : `Expense is relative; review rent and salary figures on this page for ${loc} rather than relying on informal rankings.`,
    },
    {
      q: `How much rent should I expect in ${k.city}?`,
      a: rent
        ? `A reference 1-bedroom city-centre apartment averages about ${rent} per month. Outer districts and shared flats can price lower; tourist cores can price higher.`
        : `A verified city-centre rent figure is not available for ${k.city} on this page.`,
    },
    {
      q: `What salary is needed to live in ${k.city}?`,
      a: salary && rent
        ? `Reference net salary is about ${salary}. Stress-test against the ${rent} 1BR centre benchmark plus utilities and transport before treating the average as “enough.”`
        : salary
          ? `Reference net salary is about ${salary}. Compare it to your actual housing target rather than the city-wide average alone.`
          : `A verified salary figure is not available for ${k.city} here.`,
    },
    {
      q: `Is ${k.city} good for students?`,
      a: rent
        ? `Students should prioritize housing: the 1BR centre reference is ${rent}. Shared housing and campus location can change budgets substantially versus that headline.`
        : `Students should verify housing near campus; a centre 1BR reference is not on record here.`,
    },
    {
      q: `Is ${k.city} good for families?`,
      a: `Families should model 2–3BR rents, schooling, and healthcare separately — those verified datasets are not attached on this page. Use CPI ${cpi ?? 'n/a'} and salary/rent as starting anchors only.`,
    },
    {
      q: `Can a remote worker live affordably in ${k.city}?`,
      a: cpi
        ? `Remote workers often optimize for CPI (${cpi}) and rent while earning elsewhere, but visas, tax residency, and connectivity are not verified facts on this page.`
        : `Remote affordability depends on rent and personal income; verify legal and connectivity constraints independently.`,
    },
    {
      q: `What currency is used in ${k.city}?`,
      a: `${k.city}, ${k.country} figures on this page are shown in ${k.currency} (${k.symbol.trim()}).`,
    },
    {
      q: `How reliable is cost data for ${k.city}?`,
      a: `This page uses ${k.data_source} with confidence label "${k.confidence_label}".${k.estimation_note ? ` ${k.estimation_note}` : ''} Optional domains without sources are omitted rather than invented.`,
    },
  ];

  if (peer) {
    pool.push({
      q: `Is ${k.city} cheaper than ${peer}?`,
      a: `Open the side-by-side comparison for ${k.city} and ${peer} for CPI, rent, and purchasing power. A single city page cannot settle pairwise rankings without the paired indices.`,
    });
  }

  if (nearby.length) {
    pool.push({
      q: `Which cities near ${k.city} should I compare?`,
      a: `Indexed nearby options include ${nearby.join(', ')}. Open each city page or a compare URL to inspect CPI and rent together.`,
    });
  }

  // Deduplicate by question text, then rotate for page uniqueness
  const seen = new Set<string>();
  const unique = pool.filter((f) => {
    const key = f.q.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return rotate(unique, k.pageSlug).slice(0, 8);
}

export function generateCountryFaqs(k: CountryKnowledge): FaqItem[] {
  const pool: FaqItem[] = [
    {
      q: `What currency is used in ${k.name}?`,
      a: `${k.name} costs are presented in ${k.currency} (${k.symbol.trim()}).`,
    },
    {
      q: `How many cities are indexed for ${k.name}?`,
      a: `${k.indexed_city_count} cities currently pass SEO eligibility quality gates for ${k.name}.`,
    },
    {
      q: `What is the average cost of living in ${k.name}?`,
      a:
        k.avg_cpi != null
          ? `Across the metrics sample, average CPI is about ${fmtNum(k.avg_cpi)} (NYC=100).`
          : `A blended CPI is not available yet because indexed city metrics are still limited for ${k.name}.`,
    },
    {
      q: `Which is the cheapest indexed city in ${k.name}?`,
      a: k.cheapest[0]
        ? `${k.cheapest[0].city} ranks among the lowest 1BR centre rents in the current index.`
        : `Cheapest-city rankings appear once eligible cities with rent metrics are available.`,
    },
    {
      q: `Which is the most expensive indexed city in ${k.name}?`,
      a: k.expensive[0]
        ? `${k.expensive[0].city} tends to show higher housing costs in this indexed set.`
        : `Most-expensive rankings appear as coverage grows.`,
    },
    {
      q: `How should I compare cities inside ${k.name}?`,
      a: `Open city pages or run side-by-side comparisons for rent, groceries, transport, utilities, salary, and purchasing power.`,
    },
  ];
  return rotate(pool, k.slug).slice(0, 6);
}

export function generateCompareFaqs(k: CompareKnowledge): FaqItem[] {
  const a = k.cityA;
  const b = k.cityB;
  const cheaper = k.cpiA <= k.cpiB ? a : b;
  const dearer = k.cpiA <= k.cpiB ? b : a;
  const diff = Math.abs(((k.cpiB - k.cpiA) / Math.max(k.cpiA, 1)) * 100);
  const rentWinner = k.rentA <= k.rentB ? a : b;
  const ppWinner = k.ppA >= k.ppB ? a : b;

  const pool: FaqItem[] = [
    {
      q: `Is it cheaper to live in ${a} or ${b}?`,
      a: `On CPI, ${cheaper} is cheaper than ${dearer} by roughly ${diff.toFixed(0)}% in this pairing (${k.cpiA} vs ${k.cpiB}, NYC=100).`,
    },
    {
      q: `Which city has lower rent, ${a} or ${b}?`,
      a: `${rentWinner} has the lower rent index (${Math.min(k.rentA, k.rentB)} vs ${Math.max(k.rentA, k.rentB)}).`,
    },
    {
      q: `Which city has better purchasing power?`,
      a: `${ppWinner} shows higher local purchasing power (${Math.max(k.ppA, k.ppB)} vs ${Math.min(k.ppA, k.ppB)}).`,
    },
    {
      q: `Can a student afford ${cheaper} more easily than ${dearer}?`,
      a: `Students usually feel rent first — ${rentWinner} leads on rent index. Still verify campus neighbourhoods beyond city-wide averages.`,
    },
    {
      q: `Is ${a} or ${b} better for remote workers?`,
      a: `Remote workers often optimize for ${cheaper} on CPI while checking visas and connectivity independently — those factors are not asserted as verified facts here.`,
    },
    {
      q: `How large is the cost gap between ${a} and ${b}?`,
      a: `The CPI gap is about ${diff.toFixed(0)}%. Housing and wages can widen or shrink monthly outcomes.`,
    },
  ];
  return rotate(pool, k.slug).slice(0, 6);
}
