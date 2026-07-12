import Groq from 'groq-sdk';
import dotenv from 'dotenv';
import type { PriceItem, IndexMetrics } from '../src/types.js';

dotenv.config();

// Initialize Groq client
const groqApiKey = process.env.GROQ_API_KEY;
let groq: Groq | null = null;

if (groqApiKey && groqApiKey !== 'YOUR_GROQ_API_KEY') {
  groq = new Groq({ apiKey: groqApiKey });
  console.log('✅ Groq client initialized');
} else {
  console.warn('⚠️  GROQ_API_KEY not set — Groq features disabled, will use fallback data');
}

interface GeneratedCityData {
  city: string;
  country: string;
  currency: string;
  symbol: string;
  exchange_rate: number;
  indices: IndexMetrics;
  prices: PriceItem[];
}

/**
 * Robustly extract JSON from a Groq response that may contain
 * markdown fences, leading/trailing text, or BOM characters.
 */
function extractJSON(raw: string): string {
  // Strip BOM if present
  let s = raw.replace(/^\uFEFF/, '').trim();

  // Remove markdown code fences (```json ... ``` or ``` ... ```)
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

  // Find the first { and the last } to isolate the JSON object
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('No valid JSON object found in Groq response');
  }
  return s.slice(start, end + 1);
}

/**
 * Validate the parsed city data shape — ensures all required fields exist
 * so bad Groq output fails fast with a clear error rather than silently
 * returning garbage to the frontend.
 */
function validateCityData(data: any): data is GeneratedCityData {
  if (!data || typeof data !== 'object') return false;
  if (typeof data.city !== 'string' || !data.city) return false;
  if (typeof data.country !== 'string' || !data.country) return false;
  if (typeof data.currency !== 'string' || !data.currency) return false;
  if (typeof data.symbol !== 'string' || !data.symbol) return false;
  if (typeof data.exchange_rate !== 'number') return false;

  const idx = data.indices;
  if (!idx || typeof idx !== 'object') return false;
  for (const key of ['cpi_index', 'rent_index', 'groceries_index', 'restaurant_price_index', 'local_purchasing_power_index']) {
    if (typeof idx[key] !== 'number') return false;
  }

  if (!Array.isArray(data.prices) || data.prices.length < 10) return false;

  for (const p of data.prices) {
    if (typeof p.item_id !== 'number') return false;
    if (typeof p.item_name !== 'string') return false;
    if (typeof p.average_price !== 'number') return false;
    if (typeof p.highest_price !== 'number') return false;
    if (typeof p.lowest_price !== 'number') return false;
    if (typeof p.currency !== 'string') return false;
  }

  return true;
}

// Generate city data via Groq
async function generateCityData(cityQuery: string): Promise<GeneratedCityData> {
  if (!groq) {
    throw new Error('Groq API key not configured — cannot generate city data');
  }

  const SCHEMA_EXAMPLE = JSON.stringify({
    city: "City Name",
    country: "Country Name",
    currency: "USD",
    symbol: "$",
    exchange_rate: 1.00,
    indices: {
      cpi_index: 75.0,
      rent_index: 60.0,
      groceries_index: 70.0,
      restaurant_price_index: 65.0,
      local_purchasing_power_index: 80.0
    },
    prices: [
      { item_id: 1, item_name: "Apartment (1 bedroom) in City Centre", average_price: 1500, highest_price: 2000, lowest_price: 1200, currency: "USD" },
      { item_id: 2, item_name: "Apartment (1 bedroom) Outside of Centre", average_price: 1000, highest_price: 1400, lowest_price: 800, currency: "USD" },
      { item_id: 3, item_name: "Apartment (3 bedrooms) in City Centre", average_price: 3000, highest_price: 4000, lowest_price: 2400, currency: "USD" },
      { item_id: 4, item_name: "Apartment (3 bedrooms) Outside of Centre", average_price: 2000, highest_price: 2800, lowest_price: 1600, currency: "USD" },
      { item_id: 5, item_name: "Meal, Inexpensive Restaurant", average_price: 15, highest_price: 20, lowest_price: 10, currency: "USD" },
      { item_id: 6, item_name: "Meal for 2 People, Mid-range Restaurant, Three-course", average_price: 60, highest_price: 80, lowest_price: 45, currency: "USD" },
      { item_id: 7, item_name: "Cappuccino (regular)", average_price: 4, highest_price: 6, lowest_price: 3, currency: "USD" },
      { item_id: 8, item_name: "Coke/Pepsi (0.33 liter bottle)", average_price: 2, highest_price: 3, lowest_price: 1.5, currency: "USD" },
      { item_id: 9, item_name: "Milk (regular), (1 liter)", average_price: 1.2, highest_price: 1.8, lowest_price: 0.9, currency: "USD" },
      { item_id: 10, item_name: "Loaf of Fresh White Bread (500g)", average_price: 2.5, highest_price: 3.5, lowest_price: 1.8, currency: "USD" },
      { item_id: 11, item_name: "Rice (white), (1kg)", average_price: 2, highest_price: 3, lowest_price: 1.5, currency: "USD" },
      { item_id: 12, item_name: "Eggs (regular) (12)", average_price: 3, highest_price: 4.5, lowest_price: 2.2, currency: "USD" },
      { item_id: 13, item_name: "Chicken Fillets (1kg)", average_price: 8, highest_price: 12, lowest_price: 6, currency: "USD" },
      { item_id: 14, item_name: "Apples (1kg)", average_price: 3, highest_price: 4.5, lowest_price: 2, currency: "USD" },
      { item_id: 15, item_name: "Potato (1kg)", average_price: 1.5, highest_price: 2.5, lowest_price: 1, currency: "USD" },
      { item_id: 16, item_name: "Water (1.5 liter bottle)", average_price: 1.5, highest_price: 2.5, lowest_price: 1, currency: "USD" },
      { item_id: 17, item_name: "Basic (Electricity, Heating, Cooling, Water, Garbage) for 85m2 Apartment", average_price: 120, highest_price: 180, lowest_price: 80, currency: "USD" },
      { item_id: 18, item_name: "Internet (60 Mbps or More, Unlimited Data, Cable/ADSL)", average_price: 40, highest_price: 60, lowest_price: 25, currency: "USD" },
      { item_id: 19, item_name: "One-way Ticket (Local Transport)", average_price: 1.5, highest_price: 2.5, lowest_price: 1, currency: "USD" },
      { item_id: 20, item_name: "Taxi 1km (Normal Tariff)", average_price: 1.5, highest_price: 2.5, lowest_price: 1, currency: "USD" },
      { item_id: 21, item_name: "Gasoline (1 liter)", average_price: 1.2, highest_price: 1.8, lowest_price: 0.9, currency: "USD" },
      { item_id: 22, item_name: "Average Monthly Net Salary (After Tax)", average_price: 3000, highest_price: 5000, lowest_price: 2000, currency: "USD" }
    ]
  }, null, 2);

  const systemPrompt = `You are a cost-of-living data generator. You MUST respond with ONLY valid JSON and absolutely nothing else. No markdown, no code fences, no explanations, no text before or after the JSON object.`;

  const userPrompt = `Generate realistic estimated cost-of-living data for the city: "${cityQuery}".

All price values must be in the LOCAL currency of that city (not USD).
All indices are relative to New York City (NYC = 100).
Exchange rate is local currency units per 1 USD.

Use EXACTLY this JSON structure (fill in realistic numbers):
${SCHEMA_EXAMPLE}

Rules:
- "currency" must be the ISO 4217 code (e.g. GBP, EUR, AED, INR)
- "symbol" must be the currency symbol (e.g. £, €, د.إ, ₹)
- "exchange_rate" is how many local currency units equal 1 USD
- All 22 price items must be present with item_id 1 through 22
- Prices must be realistic for the city (not zero)
- Return ONLY the JSON object`;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      console.log(`[Groq] Generating city data for "${cityQuery}" (attempt ${attempt + 1}/3)...`);

      const chatCompletion = await groq.chat.completions.create({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        model: 'llama-3.3-70b-versatile',
        temperature: 0.2,
        max_tokens: 4096,
        response_format: { type: 'json_object' },
      });

      const raw = chatCompletion.choices[0]?.message?.content ?? '';
      if (!raw.trim()) {
        throw new Error('Empty response from Groq');
      }

      const jsonStr = extractJSON(raw);
      const parsed = JSON.parse(jsonStr);

      if (!validateCityData(parsed)) {
        console.warn('[Groq] Response failed validation, retrying...', JSON.stringify(parsed).slice(0, 200));
        throw new Error('Groq response failed schema validation');
      }

      // Ensure all numeric fields are proper numbers (Groq sometimes returns strings)
      parsed.exchange_rate = Number(parsed.exchange_rate);
      parsed.indices.cpi_index = Number(parsed.indices.cpi_index);
      parsed.indices.rent_index = Number(parsed.indices.rent_index);
      parsed.indices.groceries_index = Number(parsed.indices.groceries_index);
      parsed.indices.restaurant_price_index = Number(parsed.indices.restaurant_price_index);
      parsed.indices.local_purchasing_power_index = Number(parsed.indices.local_purchasing_power_index);
      for (const p of parsed.prices) {
        p.item_id = Number(p.item_id);
        p.average_price = Number(p.average_price);
        p.highest_price = Number(p.highest_price);
        p.lowest_price = Number(p.lowest_price);
      }

      console.log(`[Groq] ✅ City data generated for "${parsed.city}, ${parsed.country}"`);
      return parsed as GeneratedCityData;
    } catch (error: any) {
      lastError = error;
      console.warn(`[Groq] Attempt ${attempt + 1} failed: ${error.message}`);
      if (attempt < 2) {
        await new Promise(resolve => setTimeout(resolve, 1500 * (attempt + 1)));
      }
    }
  }

  throw lastError ?? new Error('Failed to generate city data from Groq after 3 attempts');
}

// Generate comparison summary via Groq
async function generateSummary(
  cityA: string,
  cityB: string,
  dataA: any,
  dataB: any
): Promise<string> {
  if (!groq) {
    return generateFallbackSummary(cityA, cityB, dataA, dataB);
  }

  const prompt = `You are an expert global mobility researcher and financial adviser.
Compare the cost of living between "${cityA}" and "${cityB}".

CRITICAL RULES:
- Use ONLY the numeric indices provided below. Do not invent or reverse conclusions.
- If City B has a LOWER CPI than City A, City B is cheaper — say so.
- If City B has a HIGHER CPI than City A, City B is more expensive — say so.
- Mention currencies when relevant (${dataA.currency} vs ${dataB.currency}).
- Do not claim a city is more expensive unless its CPI/rent indices support that.

Provide a professional 2-3 paragraph summary covering:
- Approximate % difference in overall cost and rent (from the indices)
- Purchasing power comparison
- Key takeaways

City A (${cityA}) data:
- CPI Index: ${dataA.indices?.cpi_index}
- Rent Index: ${dataA.indices?.rent_index}
- Purchasing Power Index: ${dataA.indices?.local_purchasing_power_index}
- Currency: ${dataA.currency}
- Data quality: ${dataA.confidence_label || dataA.data_source || 'n/a'}

City B (${cityB}) data:
- CPI Index: ${dataB.indices?.cpi_index}
- Rent Index: ${dataB.indices?.rent_index}
- Purchasing Power Index: ${dataB.indices?.local_purchasing_power_index}
- Currency: ${dataB.currency}
- Data quality: ${dataB.confidence_label || dataB.data_source || 'n/a'}

Keep it concise, professional, and easy to understand. Plain text only, no markdown.`;

  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      console.log(`[Groq] Generating summary for ${cityA} vs ${cityB} (attempt ${attempt + 1}/3)...`);

      const chatCompletion = await groq.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        model: 'llama-3.3-70b-versatile',
        temperature: 0.7,
        max_tokens: 1024,
      });

      const content = chatCompletion.choices[0]?.message?.content?.trim() ?? '';
      if (content) {
        console.log(`[Groq] ✅ Summary generated for ${cityA} vs ${cityB}`);
        return content;
      }
      throw new Error('Empty summary response from Groq');
    } catch (error: any) {
      console.warn(`[Groq] Summary attempt ${attempt + 1} failed: ${error.message}`);
      if (attempt < 2) {
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
  }

  return generateFallbackSummary(cityA, cityB, dataA, dataB);
}

function generateFallbackSummary(
  cityA: string,
  cityB: string,
  dataA: any,
  dataB: any
): string {
  const indA = dataA.indices ?? {};
  const indB = dataB.indices ?? {};

  const cpiA = indA.cpi_index ?? 100;
  const cpiB = indB.cpi_index ?? 100;
  const rentA = indA.rent_index ?? 100;
  const rentB = indB.rent_index ?? 100;
  const ppA = indA.local_purchasing_power_index ?? 100;
  const ppB = indB.local_purchasing_power_index ?? 100;

  const diffCpi = ((cpiB - cpiA) / cpiA) * 100;
  const diffRent = ((rentB - rentA) / rentA) * 100;
  const rentStatus = diffRent > 0 ? 'higher' : 'lower';
  const cpiStatus = diffCpi > 0 ? 'more expensive' : 'more affordable';
  const absCpi = Math.abs(diffCpi).toFixed(0);
  const absRent = Math.abs(diffRent).toFixed(0);

  const betterPower = ppA > ppB ? cityA : cityB;
  const powerRatio = (Math.max(ppA, ppB) / Math.min(ppA, ppB)).toFixed(1);

  return `Based on the latest cost-of-living indicators, ${cityB} is overall ${absCpi}% ${cpiStatus} than ${cityA} (excluding housing rentals). Housing rents present an even more significant contrast, being roughly ${absRent}% ${rentStatus} in ${cityB} than in ${cityA}. Groceries and restaurant dining reflect similar variances, meaning your day-to-day expenditure will adjust proportionally based on these margins. From a purchasing power standpoint, residents of ${betterPower} enjoy a superior standard of local disposable income, with purchasing power being roughly ${powerRatio}x stronger than the comparison city. If relocating or traveling between these hubs, you can expect your earnings to stretch further in ${betterPower}, facilitating higher savings or lifestyle flexibilities depending on your specific budget constraints.`;
}

export {
  groq,
  generateCityData,
  generateSummary,
  generateFallbackSummary,
};
export type { GeneratedCityData };
