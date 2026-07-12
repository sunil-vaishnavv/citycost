/**
 * LAYER 1 — Surveyed / verified reference registry
 *
 * These are curated Numbeo-style indices (NYC = 100) plus optional
 * absolute LOCAL-currency baskets for high-trust cities.
 * Never overwritten by estimation when matched.
 */

import type { SurveyedCityRecord, CategoryIndices } from './types.js';

function cat(
  housing: number,
  groceries: number,
  restaurants: number,
  transport: number,
  utilities: number,
  healthcare: number,
  education: number,
  entertainment: number,
  salary: number
): CategoryIndices {
  const cpi = round1((groceries + restaurants + transport + utilities + healthcare + entertainment) / 6);
  return { housing, groceries, restaurants, transport, utilities, healthcare, education, entertainment, salary, cpi };
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/** Standard 22-item basket keys (must match prices.ts) */
export const BASKET_KEYS = [
  'Apartment (1 bedroom) in City Centre',
  'Apartment (1 bedroom) Outside of Centre',
  'Apartment (3 bedrooms) in City Centre',
  'Apartment (3 bedrooms) Outside of Centre',
  'Meal, Inexpensive Restaurant',
  'Meal for 2 People, Mid-range Restaurant, Three-course',
  'Cappuccino (regular)',
  'Coke/Pepsi (0.33 liter bottle)',
  'Milk (regular), (1 liter)',
  'Loaf of Fresh White Bread (500g)',
  'Rice (white), (1kg)',
  'Eggs (regular) (12)',
  'Chicken Fillets (1kg)',
  'Apples (1kg)',
  'Potato (1kg)',
  'Water (1.5 liter bottle)',
  'Basic (Electricity, Heating, Cooling, Water, Garbage) for 85m2 Apartment',
  'Internet (60 Mbps or More, Unlimited Data, Cable/ADSL)',
  'One-way Ticket (Local Transport)',
  'Taxi 1km (Normal Tariff)',
  'Gasoline (1 liter)',
  'Average Monthly Net Salary (After Tax)',
] as const;

/** India INR absolute baskets — relative ordering is intentional */
function indiaBasket(opts: {
  rent1c: number;
  rent1o: number;
  rent3c: number;
  rent3o: number;
  meal: number;
  meal2: number;
  coffee: number;
  coke: number;
  milk: number;
  bread: number;
  rice: number;
  eggs: number;
  chicken: number;
  apples: number;
  potato: number;
  water: number;
  utils: number;
  net: number;
  ticket: number;
  taxi: number;
  gas: number;
  salary: number;
}): Record<string, number> {
  return {
    'Apartment (1 bedroom) in City Centre': opts.rent1c,
    'Apartment (1 bedroom) Outside of Centre': opts.rent1o,
    'Apartment (3 bedrooms) in City Centre': opts.rent3c,
    'Apartment (3 bedrooms) Outside of Centre': opts.rent3o,
    'Meal, Inexpensive Restaurant': opts.meal,
    'Meal for 2 People, Mid-range Restaurant, Three-course': opts.meal2,
    'Cappuccino (regular)': opts.coffee,
    'Coke/Pepsi (0.33 liter bottle)': opts.coke,
    'Milk (regular), (1 liter)': opts.milk,
    'Loaf of Fresh White Bread (500g)': opts.bread,
    'Rice (white), (1kg)': opts.rice,
    'Eggs (regular) (12)': opts.eggs,
    'Chicken Fillets (1kg)': opts.chicken,
    'Apples (1kg)': opts.apples,
    'Potato (1kg)': opts.potato,
    'Water (1.5 liter bottle)': opts.water,
    'Basic (Electricity, Heating, Cooling, Water, Garbage) for 85m2 Apartment': opts.utils,
    'Internet (60 Mbps or More, Unlimited Data, Cable/ADSL)': opts.net,
    'One-way Ticket (Local Transport)': opts.ticket,
    'Taxi 1km (Normal Tariff)': opts.taxi,
    'Gasoline (1 liter)': opts.gas,
    'Average Monthly Net Salary (After Tax)': opts.salary,
  };
}

/**
 * Surveyed registry — expand over time / import from providers.
 * Ordering rules encoded in data:
 *   Pali < Ajmer/Jodhpur/Udaipur < Jaipur < Delhi < Mumbai (India housing)
 */
export const SURVEYED_CITIES: SurveyedCityRecord[] = [
  // ── USA ──────────────────────────────────────────────────────────────
  {
    city: 'New York', countryCode: 'US', country: 'United States', state: 'New York',
    population: 8_300_000, tier: 1, latitude: 40.71, longitude: -74.01,
    categories: cat(100, 100, 100, 100, 100, 100, 100, 100, 100),
    provider: 'surveyed', asOf: '2024',
  },
  {
    city: 'New York City', countryCode: 'US', country: 'United States', state: 'New York',
    population: 8_300_000, tier: 1, latitude: 40.71, longitude: -74.01,
    categories: cat(100, 100, 100, 100, 100, 100, 100, 100, 100),
    provider: 'surveyed', asOf: '2024',
  },
  {
    city: 'San Francisco', countryCode: 'US', country: 'United States', state: 'California',
    population: 870_000, tier: 1, latitude: 37.77, longitude: -122.42,
    categories: cat(95, 98, 90, 88, 92, 95, 96, 92, 125),
    provider: 'surveyed', asOf: '2024',
  },
  {
    city: 'Los Angeles', countryCode: 'US', country: 'United States', state: 'California',
    population: 3_900_000, tier: 1, latitude: 34.05, longitude: -118.24,
    categories: cat(72, 75, 72, 70, 78, 80, 82, 75, 105),
    provider: 'surveyed', asOf: '2024',
  },
  {
    city: 'Buffalo', countryCode: 'US', country: 'United States', state: 'New York',
    population: 275_000, tier: 3, latitude: 42.89, longitude: -78.88,
    categories: cat(32, 70, 62, 58, 85, 75, 70, 55, 105),
    provider: 'surveyed', asOf: '2024',
  },
  {
    city: 'Chicago', countryCode: 'US', country: 'United States',
    population: 2_700_000, tier: 2, latitude: 41.88, longitude: -87.63,
    categories: cat(55, 70, 68, 65, 80, 78, 80, 70, 112),
    provider: 'surveyed', asOf: '2024',
  },

  // ── UK ───────────────────────────────────────────────────────────────
  {
    city: 'London', countryCode: 'GB', country: 'United Kingdom', state: 'England',
    population: 9_000_000, tier: 1, latitude: 51.51, longitude: -0.13,
    categories: cat(78, 68, 80, 75, 85, 80, 85, 82, 95),
    provider: 'surveyed', asOf: '2024',
  },
  {
    city: 'Manchester', countryCode: 'GB', country: 'United Kingdom', state: 'England',
    population: 550_000, tier: 2, latitude: 53.48, longitude: -2.24,
    categories: cat(38, 55, 60, 55, 75, 70, 72, 62, 100),
    provider: 'surveyed', asOf: '2024',
  },

  // ── Japan ────────────────────────────────────────────────────────────
  {
    city: 'Tokyo', countryCode: 'JP', country: 'Japan',
    population: 14_000_000, tier: 1, latitude: 35.68, longitude: 139.69,
    categories: cat(35, 70, 40, 55, 80, 75, 78, 55, 88),
    provider: 'surveyed', asOf: '2024',
  },
  {
    city: 'Osaka', countryCode: 'JP', country: 'Japan',
    population: 2_700_000, tier: 2, latitude: 34.69, longitude: 135.5,
    categories: cat(25, 62, 35, 48, 72, 70, 72, 48, 95),
    provider: 'surveyed', asOf: '2024',
  },

  // ── UAE ──────────────────────────────────────────────────────────────
  {
    city: 'Dubai', countryCode: 'AE', country: 'United Arab Emirates',
    population: 3_500_000, tier: 1, latitude: 25.2, longitude: 55.27,
    categories: cat(55, 50, 60, 52, 70, 65, 70, 68, 112),
    provider: 'surveyed', asOf: '2024',
  },
  {
    city: 'Abu Dhabi', countryCode: 'AE', country: 'United Arab Emirates',
    population: 1_500_000, tier: 2, latitude: 24.45, longitude: 54.38,
    categories: cat(42, 48, 55, 48, 68, 62, 68, 60, 118),
    provider: 'surveyed', asOf: '2024',
  },

  // ── Australia ────────────────────────────────────────────────────────
  {
    city: 'Sydney', countryCode: 'AU', country: 'Australia',
    population: 5_300_000, tier: 1, latitude: -33.87, longitude: 151.21,
    categories: cat(62, 80, 75, 70, 85, 80, 82, 78, 110),
    provider: 'surveyed', asOf: '2024',
  },
  {
    city: 'Melbourne', countryCode: 'AU', country: 'Australia',
    population: 5_000_000, tier: 2, latitude: -37.81, longitude: 144.96,
    categories: cat(48, 75, 70, 65, 82, 78, 80, 72, 108),
    provider: 'surveyed', asOf: '2024',
  },

  // ── Europe ───────────────────────────────────────────────────────────
  {
    city: 'Paris', countryCode: 'FR', country: 'France',
    population: 2_100_000, tier: 1, latitude: 48.86, longitude: 2.35,
    categories: cat(44, 74, 72, 68, 85, 80, 85, 75, 85),
    provider: 'surveyed', asOf: '2024',
  },
  {
    city: 'Lyon', countryCode: 'FR', country: 'France',
    population: 520_000, tier: 2, latitude: 45.76, longitude: 4.84,
    categories: cat(28, 65, 60, 55, 78, 75, 78, 62, 92),
    provider: 'surveyed', asOf: '2024',
  },
  {
    city: 'Berlin', countryCode: 'DE', country: 'Germany',
    population: 3_600_000, tier: 2, latitude: 52.52, longitude: 13.4,
    categories: cat(38, 60, 55, 58, 80, 78, 80, 65, 105),
    provider: 'surveyed', asOf: '2024',
  },
  {
    city: 'Munich', countryCode: 'DE', country: 'Germany',
    population: 1_500_000, tier: 2, latitude: 48.14, longitude: 11.58,
    categories: cat(48, 65, 62, 60, 82, 80, 85, 70, 112),
    provider: 'surveyed', asOf: '2024',
  },

  // ── India (absolute INR baskets — realistic relative order) ──────────
  {
    city: 'Mumbai', countryCode: 'IN', country: 'India', state: 'Maharashtra',
    population: 20_000_000, tier: 1, latitude: 19.08, longitude: 72.88,
    categories: cat(10.5, 24.2, 18.5, 16, 22, 20, 22, 20, 55),
    localBasket: indiaBasket({
      rent1c: 55000, rent1o: 32000, rent3c: 120000, rent3o: 70000,
      meal: 400, meal2: 2000, coffee: 180, coke: 50,
      milk: 60, bread: 50, rice: 70, eggs: 90, chicken: 280, apples: 180, potato: 35, water: 20,
      utils: 3500, net: 800, ticket: 20, taxi: 25, gas: 105, salary: 55000,
    }),
    provider: 'surveyed', asOf: '2024',
  },
  {
    city: 'Delhi', countryCode: 'IN', country: 'India', state: 'Delhi',
    population: 16_000_000, tier: 1, latitude: 28.61, longitude: 77.21,
    categories: cat(8.5, 23, 17, 15, 20, 19, 21, 18, 60),
    localBasket: indiaBasket({
      rent1c: 28000, rent1o: 16000, rent3c: 65000, rent3o: 38000,
      meal: 350, meal2: 1800, coffee: 150, coke: 45,
      milk: 58, bread: 45, rice: 65, eggs: 85, chicken: 260, apples: 160, potato: 30, water: 20,
      utils: 3000, net: 700, ticket: 30, taxi: 22, gas: 105, salary: 52000,
    }),
    provider: 'surveyed', asOf: '2024',
  },
  {
    city: 'New Delhi', countryCode: 'IN', country: 'India', state: 'Delhi',
    population: 16_000_000, tier: 1, latitude: 28.61, longitude: 77.21,
    categories: cat(9, 23.5, 17.5, 15.5, 20.5, 19.5, 21.5, 18.5, 62),
    localBasket: indiaBasket({
      rent1c: 30000, rent1o: 17000, rent3c: 70000, rent3o: 40000,
      meal: 380, meal2: 1900, coffee: 160, coke: 48,
      milk: 58, bread: 48, rice: 65, eggs: 88, chicken: 270, apples: 170, potato: 32, water: 20,
      utils: 3200, net: 750, ticket: 30, taxi: 22, gas: 105, salary: 58000,
    }),
    provider: 'surveyed', asOf: '2024',
  },
  {
    city: 'Bengaluru', countryCode: 'IN', country: 'India', state: 'Karnataka',
    population: 12_000_000, tier: 2, latitude: 12.97, longitude: 77.59,
    categories: cat(7.5, 22, 16, 14, 19, 18, 20, 17, 72),
    localBasket: indiaBasket({
      rent1c: 25000, rent1o: 14000, rent3c: 55000, rent3o: 32000,
      meal: 300, meal2: 1600, coffee: 140, coke: 40,
      milk: 55, bread: 45, rice: 60, eggs: 80, chicken: 250, apples: 150, potato: 30, water: 20,
      utils: 2800, net: 700, ticket: 30, taxi: 20, gas: 105, salary: 65000,
    }),
    provider: 'surveyed', asOf: '2024',
  },
  {
    city: 'Bangalore', countryCode: 'IN', country: 'India', state: 'Karnataka',
    population: 12_000_000, tier: 2, latitude: 12.97, longitude: 77.59,
    categories: cat(7.5, 22, 16, 14, 19, 18, 20, 17, 72),
    provider: 'surveyed', asOf: '2024',
  },
  {
    city: 'Hyderabad', countryCode: 'IN', country: 'India', state: 'Telangana',
    population: 10_000_000, tier: 2,
    categories: cat(6.5, 20, 15, 13, 18, 17, 19, 15, 68),
    provider: 'surveyed', asOf: '2024',
  },
  {
    city: 'Chennai', countryCode: 'IN', country: 'India', state: 'Tamil Nadu',
    population: 10_000_000, tier: 2,
    categories: cat(6.8, 21, 15.5, 13.5, 18, 17, 19, 16, 65),
    provider: 'surveyed', asOf: '2024',
  },
  {
    city: 'Kolkata', countryCode: 'IN', country: 'India', state: 'West Bengal',
    population: 14_000_000, tier: 2,
    categories: cat(5.5, 19, 14, 12, 17, 16, 18, 14, 58),
    provider: 'surveyed', asOf: '2024',
  },
  {
    city: 'Pune', countryCode: 'IN', country: 'India', state: 'Maharashtra',
    population: 7_000_000, tier: 2,
    categories: cat(6.2, 21, 15, 13, 18, 17, 19, 16, 70),
    provider: 'surveyed', asOf: '2024',
  },
  {
    city: 'Jaipur', countryCode: 'IN', country: 'India', state: 'Rajasthan',
    population: 3_500_000, tier: 2, latitude: 26.91, longitude: 75.79,
    categories: cat(4.8, 17.5, 13, 12, 16, 15, 16, 14, 62),
    localBasket: indiaBasket({
      rent1c: 14000, rent1o: 9000, rent3c: 28000, rent3o: 18000,
      meal: 250, meal2: 1200, coffee: 120, coke: 35,
      milk: 55, bread: 40, rice: 55, eggs: 75, chicken: 230, apples: 140, potato: 28, water: 20,
      utils: 2200, net: 600, ticket: 25, taxi: 15, gas: 105, salary: 38000,
    }),
    provider: 'surveyed', asOf: '2024',
  },
  {
    city: 'Jodhpur', countryCode: 'IN', country: 'India', state: 'Rajasthan',
    population: 1_200_000, tier: 4, latitude: 26.24, longitude: 73.02,
    categories: cat(3.8, 15.5, 11.5, 10, 14, 13, 14, 11, 58),
    localBasket: indiaBasket({
      rent1c: 10000, rent1o: 6500, rent3c: 20000, rent3o: 13000,
      meal: 200, meal2: 1000, coffee: 100, coke: 30,
      milk: 52, bread: 35, rice: 50, eggs: 70, chicken: 220, apples: 130, potato: 25, water: 18,
      utils: 1800, net: 550, ticket: 20, taxi: 12, gas: 105, salary: 30000,
    }),
    provider: 'surveyed', asOf: '2024',
  },
  {
    city: 'Udaipur', countryCode: 'IN', country: 'India', state: 'Rajasthan',
    population: 650_000, tier: 4, latitude: 24.59, longitude: 73.68,
    categories: cat(4.0, 16, 12, 10.5, 14.5, 13.5, 14.5, 12, 56),
    localBasket: indiaBasket({
      rent1c: 11000, rent1o: 7000, rent3c: 22000, rent3o: 14000,
      meal: 220, meal2: 1100, coffee: 110, coke: 32,
      milk: 52, bread: 38, rice: 52, eggs: 72, chicken: 225, apples: 135, potato: 26, water: 18,
      utils: 1900, net: 550, ticket: 20, taxi: 12, gas: 105, salary: 28000,
    }),
    provider: 'surveyed', asOf: '2024',
  },
  {
    city: 'Ajmer', countryCode: 'IN', country: 'India', state: 'Rajasthan',
    population: 550_000, tier: 4, latitude: 26.45, longitude: 74.64,
    categories: cat(3.5, 15, 11, 9.5, 14, 13, 14, 10.5, 54),
    localBasket: indiaBasket({
      rent1c: 9000, rent1o: 5500, rent3c: 18000, rent3o: 11000,
      meal: 180, meal2: 900, coffee: 90, coke: 28,
      milk: 50, bread: 35, rice: 48, eggs: 68, chicken: 210, apples: 125, potato: 24, water: 18,
      utils: 1600, net: 500, ticket: 15, taxi: 10, gas: 105, salary: 26000,
    }),
    provider: 'surveyed', asOf: '2024',
  },
  {
    city: 'Pali', countryCode: 'IN', country: 'India', state: 'Rajasthan',
    population: 230_000, tier: 4, latitude: 25.77, longitude: 73.33,
    categories: cat(2.8, 14, 10, 8.5, 13, 12, 13, 9, 50),
    localBasket: indiaBasket({
      rent1c: 7500, rent1o: 4500, rent3c: 15000, rent3o: 9500,
      meal: 150, meal2: 800, coffee: 80, coke: 25,
      milk: 50, bread: 32, rice: 45, eggs: 65, chicken: 200, apples: 120, potato: 22, water: 15,
      utils: 1400, net: 450, ticket: 15, taxi: 10, gas: 105, salary: 22000,
    }),
    provider: 'surveyed', asOf: '2024',
  },
  {
    city: 'Kota', countryCode: 'IN', country: 'India', state: 'Rajasthan',
    population: 1_000_000, tier: 3, latitude: 25.18, longitude: 75.86,
    categories: cat(3.6, 15.2, 11.2, 10, 14, 13, 14, 11, 55),
    provider: 'surveyed', asOf: '2024',
  },
  {
    city: 'Bikaner', countryCode: 'IN', country: 'India', state: 'Rajasthan',
    population: 650_000, tier: 4,
    categories: cat(3.2, 14.5, 10.5, 9, 13.5, 12.5, 13.5, 10, 52),
    provider: 'surveyed', asOf: '2024',
  },
  {
    city: 'Ahmedabad', countryCode: 'IN', country: 'India', state: 'Gujarat',
    population: 8_000_000, tier: 2,
    categories: cat(5, 18, 13, 12, 16, 15, 17, 14, 65),
    provider: 'surveyed', asOf: '2024',
  },
  {
    city: 'Chandigarh', countryCode: 'IN', country: 'India',
    population: 1_200_000, tier: 2,
    categories: cat(5.5, 19, 14, 12, 17, 16, 18, 15, 70),
    provider: 'surveyed', asOf: '2024',
  },
  {
    city: 'Lucknow', countryCode: 'IN', country: 'India', state: 'Uttar Pradesh',
    population: 3_500_000, tier: 2,
    categories: cat(4, 16.5, 12, 11, 15, 14, 15, 12, 55),
    provider: 'surveyed', asOf: '2024',
  },
  {
    city: 'Surat', countryCode: 'IN', country: 'India', state: 'Gujarat',
    population: 7_000_000, tier: 2,
    categories: cat(4.5, 17, 12.5, 11.5, 15.5, 14.5, 16, 13, 64),
    provider: 'surveyed', asOf: '2024',
  },

  // Canada / Singapore
  {
    city: 'Toronto', countryCode: 'CA', country: 'Canada',
    population: 2_800_000, tier: 2,
    categories: cat(52, 70, 65, 60, 78, 75, 78, 68, 95),
    provider: 'surveyed', asOf: '2024',
  },
  {
    city: 'Singapore', countryCode: 'SG', country: 'Singapore',
    population: 5_900_000, tier: 1,
    categories: cat(85, 82, 65, 70, 80, 75, 85, 70, 92),
    provider: 'surveyed', asOf: '2024',
  },
];

function normalize(value: string): string {
  return value.trim().toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

export function findSurveyedCity(
  city: string,
  state: string,
  countryCode: string
): SurveyedCityRecord | null {
  const c = normalize(city);
  const s = normalize(state);
  const exact = SURVEYED_CITIES.find(
    (a) =>
      normalize(a.city) === c &&
      a.countryCode === countryCode &&
      (!a.state || !s || normalize(a.state) === s)
  );
  if (exact) return exact;
  return SURVEYED_CITIES.find((a) => normalize(a.city) === c && a.countryCode === countryCode) || null;
}

export function findSurveyedInState(state: string, countryCode: string, excludeCity: string): SurveyedCityRecord[] {
  const s = normalize(state);
  const ex = normalize(excludeCity);
  return SURVEYED_CITIES.filter(
    (a) =>
      a.countryCode === countryCode &&
      normalize(a.city) !== ex &&
      (!s || !a.state || normalize(a.state) === s)
  );
}

export function findSurveyedInCountry(countryCode: string, excludeCity: string): SurveyedCityRecord[] {
  const ex = normalize(excludeCity);
  return SURVEYED_CITIES.filter((a) => a.countryCode === countryCode && normalize(a.city) !== ex);
}
