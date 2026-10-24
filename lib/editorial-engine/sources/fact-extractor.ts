/**
 * Fact Extractor: parses search snippets and civic metrics into structured,
 * quantified facts linked to verifiable sources.
 */

import type { CivicDataMetric, ExtractedSourceFact, RealDataSource } from './types.js';

function categorizeStatement(text: string): ExtractedSourceFact['category'] {
  const t = text.toLowerCase();
  if (/rent|apartment|housing|lease|studio|1-bedroom|2-bedroom/i.test(t)) return 'rent';
  if (/salary|wage|income|earning|paycheck|compensation/i.test(t)) return 'salary';
  if (/transit|subway|metro|bus|train|fare|commute|pass|petrol|gas price/i.test(t)) return 'transport';
  if (/grocer|supermarket|food|dining|meal|restaurant|milk|bread/i.test(t)) return 'groceries';
  if (/utilit|electric|water|heating|internet|broadband|energy bill/i.test(t)) return 'utilities';
  if (/tax|vat|income tax|sales tax|property tax/i.test(t)) return 'tax';
  if (/population|resident|demographic|census/i.test(t)) return 'demographics';
  if (/temperature|weather|climate|rainfall|sunny|snow/i.test(t)) return 'weather';
  return 'general';
}

function extractFigure(text: string): string | undefined {
  const m = text.match(
    /(?:[$€£¥₹]\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:-|–|to)\s?[$€£¥₹]?\s?\d[\d,]*(?:\.\d+)?)?(?:\s?\/\s?(?:mo|month|year|yr|hr|hour))?|\d[\d,]*(?:\.\d+)?\s?(?:%|EUR|USD|GBP|JPY|INR|CHF|AUD|CAD)\b)/i
  );
  return m ? m[0].trim() : undefined;
}

export function extractFactsFromSources(
  sources: RealDataSource[],
  options: { targetCity?: string; comparisonCity?: string } = {}
): ExtractedSourceFact[] {
  const facts: ExtractedSourceFact[] = [];
  const seenStatements = new Set<string>();

  for (const source of sources) {
    if (!source.snippet) continue;

    // Split snippet into individual sentences
    const sentences = source.snippet
      .replace(/\s+/g, ' ')
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 25 && s.length <= 280);

    for (const sentence of sentences) {
      // Must contain numbers or currency or percentage to be a verifiable factual claim
      if (!/\d/.test(sentence)) continue;

      const norm = sentence.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (seenStatements.has(norm)) continue;
      seenStatements.add(norm);

      const category = categorizeStatement(sentence);
      const figure = extractFigure(sentence);

      // Determine city association if named in sentence
      let city: string | undefined;
      if (options.targetCity && sentence.toLowerCase().includes(options.targetCity.split(',')[0].toLowerCase())) {
        city = options.targetCity;
      } else if (
        options.comparisonCity &&
        sentence.toLowerCase().includes(options.comparisonCity.split(',')[0].toLowerCase())
      ) {
        city = options.comparisonCity;
      }

      facts.push({
        category,
        statement: sentence,
        figure,
        city,
        sourceId: source.id,
        sourceTitle: source.title,
        sourceUrl: source.url,
      });

      if (facts.length >= 16) break;
    }

    if (facts.length >= 16) break;
  }

  return facts;
}

export function extractFactsFromCivicMetrics(
  metrics: CivicDataMetric[],
  sources: RealDataSource[],
  cityName: string
): ExtractedSourceFact[] {
  const facts: ExtractedSourceFact[] = [];

  for (const m of metrics) {
    const matchingSource = sources.find((s) => s.url === m.sourceUrl) || sources[0];
    const sourceId = matchingSource ? matchingSource.id : 101;
    const sourceTitle = matchingSource ? matchingSource.title : m.sourceAgency;
    const sourceUrl = matchingSource ? matchingSource.url : m.sourceUrl;

    const statement = `According to the ${m.sourceAgency}, the ${m.name.toLowerCase()} in ${cityName} is ${m.value}${m.period ? ` (${m.period})` : ''}.`;

    facts.push({
      category: m.category,
      statement,
      figure: String(m.value),
      city: cityName,
      sourceId,
      sourceTitle,
      sourceUrl,
    });
  }

  return facts;
}
