import type { StructuredContextPack } from '../writer/context-pack.js';
import type { ResearchEntities } from './schema.js';

function uniq(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const s = String(raw || '').trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

const TRANSPORT_BY_HINT: Array<{ match: RegExp; labels: string[] }> = [
  { match: /\b(london|uk|united kingdom|manchester)\b/i, labels: ['Transport for London (TfL)', 'National Rail', 'buses'] },
  { match: /\b(berlin|munich|hamburg|germany)\b/i, labels: ['U-Bahn', 'S-Bahn', 'Deutsche Bahn', 'local trams'] },
  { match: /\b(paris|lyon|france)\b/i, labels: ['Métropolitain', 'RER', 'SNCF', 'Vélib'] },
  { match: /\b(tokyo|osaka|japan)\b/i, labels: ['JR lines', 'Tokyo Metro', 'IC cards'] },
  { match: /\b(new york|chicago|united states|usa)\b/i, labels: ['subway/metro', 'commuter rail', 'rideshare'] },
  { match: /\b(singapore)\b/i, labels: ['MRT', 'buses', 'EZ-Link'] },
  { match: /\b(dubai|abu dhabi|uae)\b/i, labels: ['Dubai Metro', 'taxis', 'rideshare'] },
  { match: /\b(mumbai|delhi|bengaluru|india)\b/i, labels: ['metro', 'local trains', 'auto-rickshaws', 'app cabs'] },
];

const HEALTHCARE_BY_HINT: Array<{ match: RegExp; labels: string[] }> = [
  { match: /\b(united kingdom|uk|london)\b/i, labels: ['NHS'] },
  { match: /\b(germany|berlin|munich)\b/i, labels: ['statutory health insurance (GKV)', 'private insurance (PKV)'] },
  { match: /\b(france|paris)\b/i, labels: ['Assurance Maladie', 'carte Vitale'] },
  { match: /\b(japan|tokyo)\b/i, labels: ['National Health Insurance', 'Employees’ Health Insurance'] },
  { match: /\b(united states|usa|new york)\b/i, labels: ['private health insurance', 'employer plans', 'Medicare/Medicaid (eligibility-dependent)'] },
  { match: /\b(singapore)\b/i, labels: ['MediShield Life', 'Medisave'] },
  { match: /\b(uae|dubai|abu dhabi)\b/i, labels: ['mandatory health insurance schemes'] },
  { match: /\b(australia|sydney|melbourne)\b/i, labels: ['Medicare', 'private health insurance'] },
  { match: /\b(canada|toronto|vancouver)\b/i, labels: ['provincial public health insurance'] },
];

const VISA_BY_HINT: Array<{ match: RegExp; labels: string[] }> = [
  { match: /\b(germany|berlin|munich)\b/i, labels: ['EU Blue Card', 'Job Seeker Visa', 'freelance residence permit'] },
  { match: /\b(united kingdom|uk|london)\b/i, labels: ['Skilled Worker visa', 'Graduate visa', 'Student visa'] },
  { match: /\b(uae|dubai)\b/i, labels: ['employment residence visa', 'remote work / virtual working visa (where applicable)'] },
  { match: /\b(portugal|lisbon)\b/i, labels: ['D7 visa', 'digital nomad visa'] },
  { match: /\b(spain|madrid|barcelona)\b/i, labels: ['digital nomad visa', 'non-lucrative residence'] },
  { match: /\b(singapore)\b/i, labels: ['Employment Pass', 'S Pass', 'Student Pass'] },
  { match: /\b(australia)\b/i, labels: ['Temporary Skill Shortage visa', 'Working Holiday visa'] },
  { match: /\b(japan|tokyo)\b/i, labels: ['Engineer/Specialist in Humanities visa', 'Student visa'] },
  { match: /\b(united states|usa)\b/i, labels: ['H-1B', 'F-1 student visa', 'L-1 (employer-specific)'] },
  { match: /\b(canada)\b/i, labels: ['Express Entry', 'study permit', 'work permit'] },
];

const UNI_BY_HINT: Array<{ match: RegExp; labels: string[] }> = [
  { match: /\bberlin\b/i, labels: ['Humboldt University', 'Free University of Berlin', 'TU Berlin'] },
  { match: /\bmunich\b/i, labels: ['LMU Munich', 'Technical University of Munich'] },
  { match: /\blondon\b/i, labels: ['UCL', 'Imperial College London', 'King’s College London'] },
  { match: /\bparis\b/i, labels: ['Sorbonne', 'Sciences Po'] },
  { match: /\btokyo\b/i, labels: ['University of Tokyo', 'Waseda University'] },
  { match: /\bboston\b/i, labels: ['Harvard University', 'MIT'] },
  { match: /\bsingapore\b/i, labels: ['NUS', 'NTU'] },
  { match: /\bmumbai\b/i, labels: ['University of Mumbai', 'IIT Bombay'] },
  { match: /\bdelhi\b/i, labels: ['University of Delhi', 'IIT Delhi'] },
];

const NEIGHBOURHOOD_BY_CITY: Record<string, string[]> = {
  berlin: ['Mitte', 'Kreuzberg', 'Prenzlauer Berg', 'Neukölln', 'Charlottenburg'],
  munich: ['Maxvorstadt', 'Schwabing', 'Giesing', 'Sendling'],
  hamburg: ['Altona', 'St. Pauli', 'Eimsbüttel'],
  london: ['Zone 1–2 neighbourhoods', 'Zone 3+ suburbs'],
  paris: ['Arrondissements 1–20 (central vs outer)'],
  'new york': ['Manhattan', 'Brooklyn', 'Queens'],
  tokyo: ['Shibuya', 'Shinjuku', 'Setagaya'],
  dubai: ['Marina', 'Downtown', 'JLT'],
  mumbai: ['Bandra', 'Andheri', 'South Mumbai'],
  sydney: ['Inner West', 'Eastern Suburbs', 'CBD fringe'],
};

function haystack(ctx: StructuredContextPack, topicTitle: string): string {
  const parts = [
    topicTitle,
    String(ctx.city?.city || ''),
    String(ctx.city?.country || ''),
    String(ctx.country?.name || ''),
    String(ctx.comparison?.cityA || ''),
    String(ctx.comparison?.cityB || ''),
    String(ctx.comparison?.queryA || ''),
    String(ctx.comparison?.queryB || ''),
    ...ctx.related_cities.map((c) => c.label),
    ...ctx.related_countries.map((c) => c.label),
  ];
  return parts.join(' | ');
}

function matchLabels(text: string, rules: Array<{ match: RegExp; labels: string[] }>): string[] {
  const out: string[] = [];
  for (const rule of rules) {
    if (rule.match.test(text)) out.push(...rule.labels);
  }
  return out;
}

/**
 * Extract typed entities from CityCost context + curated GEO knowledge.
 * Never invents numeric statistics — only named entities useful for EEAT framing.
 */
export function extractResearchEntities(
  ctx: StructuredContextPack,
  topicTitle: string
): ResearchEntities {
  const text = haystack(ctx, topicTitle);
  const cities: string[] = [];
  const countries: string[] = [];
  const currencies: string[] = [];

  const primaryCities: string[] = [];
  if (ctx.comparison) {
    if (ctx.comparison.cityA) {
      cities.push(String(ctx.comparison.cityA));
      primaryCities.push(String(ctx.comparison.cityA));
    }
    if (ctx.comparison.cityB) {
      cities.push(String(ctx.comparison.cityB));
      primaryCities.push(String(ctx.comparison.cityB));
    }
  }
  if (ctx.city?.city) {
    cities.push(String(ctx.city.city));
    primaryCities.push(String(ctx.city.city));
  }
  if (ctx.city?.country) countries.push(String(ctx.city.country));
  if (ctx.country?.name) countries.push(String(ctx.country.name));
  if (ctx.country?.currency) currencies.push(String(ctx.country.currency));

  // Title "Berlin vs Munich …" recovers the pair when comparison context failed to resolve.
  const vsTitle = topicTitle.match(
    /\b([A-Z][A-Za-z .'-]+?)\s+vs\.?\s+([A-Z][A-Za-z .'-]+?)(?:\s+Cost|\s*\(|:|,|$)/
  );
  if (vsTitle) {
    const a = vsTitle[1].trim();
    const b = vsTitle[2].trim();
    if (a && b) {
      cities.unshift(a, b);
      if (!primaryCities.length) primaryCities.push(a, b);
    }
  }

  // Related cities are supporting links — never let them displace the comparison pair.
  if (!ctx.comparison && primaryCities.length < 2) {
    for (const c of ctx.related_cities.slice(0, 8)) {
      const name = c.label.split(',')[0]?.trim();
      if (name) cities.push(name);
    }
  } else {
    for (const c of ctx.related_cities.slice(0, 8)) {
      const name = c.label.split(',')[0]?.trim();
      if (name && !primaryCities.some((p) => p.toLowerCase() === name.toLowerCase())) {
        cities.push(name);
      }
    }
  }
  for (const c of ctx.related_countries.slice(0, 6)) countries.push(c.label);

  const neighbourhoods: string[] = [];
  for (const city of primaryCities.slice(0, 2)) {
    const key = city.toLowerCase();
    const hit = NEIGHBOURHOOD_BY_CITY[key];
    if (hit) neighbourhoods.push(...hit);
  }

  const transportation = matchLabels(text, TRANSPORT_BY_HINT);
  if (!transportation.length) {
    transportation.push('public transit', 'walking/cycling', 'rideshare or taxis');
  }

  const healthcare_systems = matchLabels(text, HEALTHCARE_BY_HINT);
  if (!healthcare_systems.length) {
    healthcare_systems.push('local public/private healthcare mix (verify locally)');
  }

  const visa_names = matchLabels(text, VISA_BY_HINT);
  const universities = matchLabels(text, UNI_BY_HINT);

  const government_programs: string[] = [];
  if (/\bgermany\b/i.test(text)) government_programs.push('public broadcasting fee (Rundfunkbeitrag)');
  if (/\bunited kingdom|\buk\b/i.test(text)) government_programs.push('Council Tax');
  if (/\bsingapore\b/i.test(text)) government_programs.push('CPF (where applicable)');
  if (/\baustralia\b/i.test(text)) government_programs.push('Medicare levy (residency-dependent)');

  const other = [
    'cost of living index',
    'purchasing power',
    'rent index',
    'groceries index',
  ];

  return {
    cities: uniq(cities).slice(0, 16),
    countries: uniq(countries).slice(0, 12),
    currencies: uniq(currencies).slice(0, 6),
    transportation: uniq(transportation).slice(0, 10),
    universities: uniq(universities).slice(0, 8),
    neighbourhoods: uniq(neighbourhoods).slice(0, 12),
    government_programs: uniq(government_programs).slice(0, 8),
    visa_names: uniq(visa_names).slice(0, 8),
    healthcare_systems: uniq(healthcare_systems).slice(0, 8),
    other: uniq(other).slice(0, 8),
  };
}
