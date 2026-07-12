/**
 * Keyword cluster engine — INTERNAL ONLY (never serialize to public HTML/API payloads).
 */

import type { CityLandingKind, CategoryHubId, CountryGuideKind, KeywordClusterInternal } from './types.js';
import { landingKindToIntent, categoryToIntent } from './intent.js';

export function buildCityLandingKeywords(
  kind: CityLandingKind,
  city: string,
  country: string
): KeywordClusterInternal {
  const intent = landingKindToIntent(kind);
  const templates: Record<CityLandingKind, KeywordClusterInternal> = {
    'living-in': {
      primary: `cost of living in ${city}`,
      secondary: [`living in ${city}`, `${city} living costs`, `${city} ${country} cost of living`],
      long_tail: [`is ${city} expensive to live in`, `monthly budget ${city}`, `living expenses ${city} ${country}`],
      related_questions: [`Is ${city} expensive?`, `How much do you need to live in ${city}?`, `What is the cost of living in ${city}?`],
      search_intent: intent,
    },
    rent: {
      primary: `rent in ${city}`,
      secondary: [`${city} apartment rent`, `1 bedroom rent ${city}`, `housing costs ${city}`],
      long_tail: [`average rent ${city} ${country}`, `is rent high in ${city}`, `cheap apartments ${city}`],
      related_questions: [`How much is rent in ${city}?`, `Is housing expensive in ${city}?`],
      search_intent: intent,
    },
    salary: {
      primary: `average salary in ${city}`,
      secondary: [`${city} salary`, `net salary ${city}`, `purchasing power ${city}`],
      long_tail: [`what salary do you need in ${city}`, `${city} wages after tax`],
      related_questions: [`What is the average salary in ${city}?`, `Is salary enough for rent in ${city}?`],
      search_intent: intent,
    },
    students: {
      primary: `${city} for students`,
      secondary: [`student cost of living ${city}`, `studying in ${city} budget`],
      long_tail: [`can students afford ${city}`, `cheap student cities near ${city}`],
      related_questions: [`Is ${city} good for students?`, `How much do students need in ${city}?`],
      search_intent: intent,
    },
    families: {
      primary: `${city} for families`,
      secondary: [`family cost of living ${city}`, `raising a family in ${city}`],
      long_tail: [`family budget ${city} ${country}`, `is ${city} family friendly cost wise`],
      related_questions: [`Is ${city} good for families?`, `What does a family spend in ${city}?`],
      search_intent: intent,
    },
    'remote-work': {
      primary: `remote work in ${city}`,
      secondary: [`${city} for remote workers`, `digital lifestyle cost ${city}`],
      long_tail: [`live in ${city} work remotely cost`, `coworking cities like ${city}`],
      related_questions: [`Is ${city} good for remote workers?`, `Cost of living for remote workers in ${city}?`],
      search_intent: intent,
    },
    retirement: {
      primary: `retire in ${city}`,
      secondary: [`retirement cost ${city}`, `${city} for retirees`],
      long_tail: [`is ${city} affordable for retirement`, `fixed income living ${city}`],
      related_questions: [`Is ${city} good for retirement?`, `Cost of retiring in ${city}?`],
      search_intent: intent,
    },
    'moving-to': {
      primary: `moving to ${city}`,
      secondary: [`relocate to ${city}`, `move to ${city} cost`],
      long_tail: [`pros cons moving to ${city}`, `cost of relocating to ${city} ${country}`],
      related_questions: [`How much does it cost to move to ${city}?`, `Is moving to ${city} worth it?`],
      search_intent: intent,
    },
    'digital-nomads': {
      primary: `${city} for digital nomads`,
      secondary: [`nomad cost of living ${city}`, `${city} backpacker budget`],
      long_tail: [`is ${city} a digital nomad hub`, `monthly nomad budget ${city}`],
      related_questions: [`Is ${city} good for digital nomads?`, `Nomad budget for ${city}?`],
      search_intent: intent,
    },
  };
  return templates[kind];
}

export function buildCategoryKeywords(id: CategoryHubId): KeywordClusterInternal {
  const intent = categoryToIntent(id);
  const map: Record<CategoryHubId, KeywordClusterInternal> = {
    students: {
      primary: 'best cities for students cost of living',
      secondary: ['student cities cheap', 'student living costs worldwide'],
      long_tail: ['affordable cities for university students', 'cheapest student cities'],
      related_questions: ['Which cities are cheapest for students?', 'Best student cities by cost?'],
      search_intent: intent,
    },
    families: {
      primary: 'best cities for families cost of living',
      secondary: ['family friendly cities cost', 'raising kids cost of living'],
      long_tail: ['affordable cities for families', 'family budget city comparison'],
      related_questions: ['Which cities are best for families on a budget?'],
      search_intent: intent,
    },
    'remote-workers': {
      primary: 'best cities for remote workers',
      secondary: ['remote work cost of living', 'live abroad remote salary'],
      long_tail: ['cheapest cities for remote workers', 'high purchasing power remote cities'],
      related_questions: ['Where should remote workers live cheaply?'],
      search_intent: intent,
    },
    retirement: {
      primary: 'best cities for retirement cost of living',
      secondary: ['retire abroad cheap', 'retirement living costs'],
      long_tail: ['affordable retirement cities', 'fixed income city costs'],
      related_questions: ['Which cities are affordable for retirees?'],
      search_intent: intent,
    },
    'digital-nomads': {
      primary: 'best cities for digital nomads',
      secondary: ['nomad cost of living', 'digital nomad hubs cheap'],
      long_tail: ['cheapest digital nomad cities 2026', 'nomad monthly budget cities'],
      related_questions: ['Best digital nomad cities by cost?'],
      search_intent: intent,
    },
    'cheapest-cities': {
      primary: 'cheapest cities cost of living',
      secondary: ['lowest cost of living cities', 'affordable cities worldwide'],
      long_tail: ['cheapest cities to live in 2026', 'low CPI cities'],
      related_questions: ['What are the cheapest cities to live in?'],
      search_intent: intent,
    },
    'most-expensive-cities': {
      primary: 'most expensive cities cost of living',
      secondary: ['highest cost of living cities', 'expensive cities rent'],
      long_tail: ['priciest cities to live in 2026', 'high CPI cities'],
      related_questions: ['What are the most expensive cities?'],
      search_intent: intent,
    },
  };
  return map[id];
}

export function buildCountryGuideKeywords(
  kind: CountryGuideKind,
  country: string
): KeywordClusterInternal {
  const base: Record<CountryGuideKind, KeywordClusterInternal> = {
    'living-in-country': {
      primary: `cost of living in ${country}`,
      secondary: [`living in ${country}`, `${country} living costs`],
      long_tail: [`is ${country} expensive`, `monthly budget ${country}`],
      related_questions: [`What is the cost of living in ${country}?`],
      search_intent: 'living_cost',
    },
    'best-cities': {
      primary: `best cities in ${country} cost of living`,
      secondary: [`top cities ${country}`, `${country} metro costs`],
      long_tail: [`which city in ${country} to live`, `compare cities in ${country}`],
      related_questions: [`What are the best cities in ${country} for living costs?`],
      search_intent: 'city_comparison',
    },
    'student-cities': {
      primary: `student cities in ${country}`,
      secondary: [`best cities for students ${country}`],
      long_tail: [`cheap student cities ${country}`],
      related_questions: [`Best student cities in ${country}?`],
      search_intent: 'students',
    },
    'family-cities': {
      primary: `family cities in ${country}`,
      secondary: [`best cities for families ${country}`],
      long_tail: [`affordable family cities ${country}`],
      related_questions: [`Best family cities in ${country}?`],
      search_intent: 'families',
    },
    'retirement-cities': {
      primary: `retirement cities in ${country}`,
      secondary: [`retire in ${country} cities`],
      long_tail: [`affordable retirement ${country}`],
      related_questions: [`Best retirement cities in ${country}?`],
      search_intent: 'retirement',
    },
    'remote-work-cities': {
      primary: `remote work cities in ${country}`,
      secondary: [`best remote cities ${country}`],
      long_tail: [`digital nomad cities ${country}`],
      related_questions: [`Best remote work cities in ${country}?`],
      search_intent: 'remote_workers',
    },
  };
  return base[kind];
}
