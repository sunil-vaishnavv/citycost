/**
 * Guide Router — content_type → GuideId (no shared general outline).
 */

import type { GuideId } from './types.js';

const ALIASES: Record<string, GuideId> = {
  country_guide: 'country',
  city_guide: 'city',
  comparison_guide: 'comparison',
  salary_guide: 'salary',
  rent_guide: 'rent',
  food_guide: 'food',
  healthcare_guide: 'healthcare',
  transportation_guide: 'city',
  transport_guide: 'city',
  student_guide: 'student',
  visa_guide: 'visa',
  retirement_guide: 'retirement',
  moving_guide: 'moving',
  remote_worker_guide: 'remote',
  remote_work_guide: 'remote',
  budget_guide: 'budget',
  tax_guide: 'tax',
  travel_guide: 'travel',
  checklist: 'moving',
};

export function routeGuideId(contentType: string | null | undefined, title = ''): GuideId {
  const key = String(contentType || '')
    .toLowerCase()
    .trim();
  if (ALIASES[key]) return ALIASES[key];

  const blob = `${key} ${title}`.toLowerCase();
  if (/compar|vs\b|versus/.test(blob)) return 'comparison';
  if (/visa|residence permit|immigration/.test(blob)) return 'visa';
  if (/salary|wage|take.?home|compensation/.test(blob)) return 'salary';
  if (/\brent\b|apartment cost|housing cost/.test(blob)) return 'rent';
  if (/food|grocer|dining/.test(blob)) return 'food';
  if (/health|hospital|insurance/.test(blob)) return 'healthcare';
  if (/student|university|tuition/.test(blob)) return 'student';
  if (/retire|pension/.test(blob)) return 'retirement';
  if (/mov(e|ing) to|relocati/.test(blob)) return 'moving';
  if (/remote|digital nomad/.test(blob)) return 'remote';
  if (/budget|cheap(er)? living/.test(blob)) return 'budget';
  if (/\btax\b/.test(blob)) return 'tax';
  if (/travel|trip|visit/.test(blob)) return 'travel';
  if (/country|living in [a-z].*cost/.test(blob)) return 'country';
  if (/city|living in/.test(blob)) return 'city';
  // Nearest heuristic — never a shared skeleton guide
  return 'moving';
}

export const GUIDE_LABELS: Record<GuideId, string> = {
  country: 'Country Guide',
  city: 'City Guide',
  comparison: 'Comparison Guide',
  salary: 'Salary Guide',
  rent: 'Rent Guide',
  food: 'Food Guide',
  healthcare: 'Healthcare Guide',
  student: 'Student Guide',
  visa: 'Visa Guide',
  moving: 'Moving Guide',
  retirement: 'Retirement Guide',
  budget: 'Budget Guide',
  remote: 'Remote Guide',
  travel: 'Travel Guide',
  tax: 'Tax Guide',
};
