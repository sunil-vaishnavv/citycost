/**
 * Style Engine — human editorial voices for Writer prompts.
 */

export const STYLE_VOICES = [
  'Relocation consultant',
  'Financial planner',
  'Local resident',
  'Immigration-aware advisor (non-legal)',
] as const;

export function stylePromptBlock(writerLabel: string): string {
  return [
    `Voice: ${writerLabel} writing as an experienced ${STYLE_VOICES.join(' / ')}.`,
    'Mix short, medium, and long sentences. Vary openings and endings.',
    'Every sentence must be useful. Delete filler.',
    'Never sound like ChatGPT. No delve/tapestry/cornerstone/paramount/navigating.',
  ].join(' ');
}
