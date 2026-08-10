/**
 * Dedicated Writer contract — one writer per content type.
 */

export type WriterId =
  | 'country_guide'
  | 'city_guide'
  | 'comparison_guide'
  | 'salary_guide'
  | 'rent_guide'
  | 'food_guide'
  | 'healthcare_guide'
  | 'transportation_guide'
  | 'student_guide'
  | 'visa_guide'
  | 'retirement_guide'
  | 'moving_guide'
  | 'remote_worker_guide'
  | 'budget_guide'
  | 'tax_guide'
  | 'general_guide';

export interface DedicatedWriter {
  id: WriterId;
  label: string;
  purpose: string;
  voice: string;
  structure: string[];
  focus_lines: string[];
  section_bias: Record<string, string>;
  do: string[];
  dont: string[];
  summary_brief: string;
  system_rules: string[];
}

export interface RoutedWriter {
  writer: DedicatedWriter;
  content_type: string;
  matched: boolean;
}
