/**
 * Writer Router — pick exactly one Dedicated Writer from content_type.
 * Never fall back to a single shared master writing strategy.
 */

import { WRITERS } from './writers/registry.js';
import type { DedicatedWriter, RoutedWriter, WriterId } from './writers/types.js';

const ALIASES: Record<string, WriterId> = {
  country_guide: 'country_guide',
  city_guide: 'city_guide',
  comparison_guide: 'comparison_guide',
  salary_guide: 'salary_guide',
  rent_guide: 'rent_guide',
  food_guide: 'food_guide',
  healthcare_guide: 'healthcare_guide',
  transportation_guide: 'transportation_guide',
  transport_guide: 'transportation_guide',
  student_guide: 'student_guide',
  visa_guide: 'visa_guide',
  retirement_guide: 'retirement_guide',
  moving_guide: 'moving_guide',
  remote_worker_guide: 'remote_worker_guide',
  remote_work_guide: 'remote_worker_guide',
  budget_guide: 'budget_guide',
  tax_guide: 'tax_guide',
  checklist: 'moving_guide',
  faq_hub: 'general_guide',
};

export function detectWriterId(contentType: string | null | undefined): WriterId {
  const key = String(contentType || '')
    .toLowerCase()
    .trim();
  return ALIASES[key] || 'general_guide';
}

/** Route to one dedicated writer. Always returns a writer. */
export function routeWriter(contentType: string | null | undefined): RoutedWriter {
  const id = detectWriterId(contentType);
  const matched = Boolean(ALIASES[String(contentType || '').toLowerCase().trim()]);
  const writer: DedicatedWriter = WRITERS[id] || WRITERS.general_guide;
  return {
    writer,
    content_type: String(contentType || 'general_guide'),
    matched,
  };
}

/** Compact prompt block for AI section batches. */
export function routedWriterPromptBlock(contentType: string | null | undefined): Record<string, unknown> {
  const { writer, content_type, matched } = routeWriter(contentType);
  return {
    writer_id: writer.id,
    writer_label: writer.label,
    content_type,
    matched_dedicated_writer: matched,
    purpose: writer.purpose,
    voice: writer.voice,
    structure: writer.structure,
    focus_lines: writer.focus_lines,
    section_bias: writer.section_bias,
    do: writer.do,
    dont: writer.dont,
    summary_brief: writer.summary_brief,
    system_rules: writer.system_rules,
  };
}

export function listRegisteredWriters(): DedicatedWriter[] {
  return Object.values(WRITERS);
}
