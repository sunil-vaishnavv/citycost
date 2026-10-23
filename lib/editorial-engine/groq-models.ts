import { cachedLiveModelIds } from './ai/model-catalog.js';
/**
 * Allowed Groq chat models for editorial Writer / Reviewer.
 * Free-text / non-Groq IDs are rejected at settings save time.
 */
export const GROQ_CHAT_MODELS = [
  {
    id: 'openai/gpt-oss-120b',
    label: 'GPT-OSS 120B',
    hint: 'Best quality on Groq',
  },
  {
    id: 'openai/gpt-oss-20b',
    label: 'GPT-OSS 20B',
    hint: 'Faster / lighter on daily token quota',
  },
  {
    id: 'qwen/qwen3.8-27b',
    label: 'Qwen 3.8 27B',
    hint: 'Alternative family — useful when GPT-OSS is rate limited',
  },
] as const;

export type GroqChatModelId = (typeof GROQ_CHAT_MODELS)[number]['id'];

const ALLOWED = new Set<string>(GROQ_CHAT_MODELS.map((m) => m.id));

/**
 * Static list OR any model currently offered by a configured provider (live
 * catalog cache). The router skips models a provider no longer offers and
 * auto-switches, so an outdated choice cannot break generation.
 */
export function isAllowedGroqModel(model: string): model is GroqChatModelId {
  return ALLOWED.has(model) || cachedLiveModelIds().has(model);
}

export function assertAllowedGroqModel(model: string, field: string): GroqChatModelId {
  if (!isAllowedGroqModel(model)) {
    throw new Error(
      `${field} must be a supported Groq model. Allowed: ${GROQ_CHAT_MODELS.map((m) => m.id).join(', ')}`
    );
  }
  return model;
}
