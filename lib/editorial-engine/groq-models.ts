/**
 * Allowed Groq chat models for editorial Writer / Reviewer.
 * Free-text / non-Groq IDs are rejected at settings save time.
 */
export const GROQ_CHAT_MODELS = [
  {
    id: 'llama-3.3-70b-versatile',
    label: 'Llama 3.3 70B Versatile',
    hint: 'Best quality — uses more daily tokens',
  },
  {
    id: 'llama-3.1-8b-instant',
    label: 'Llama 3.1 8B Instant',
    hint: 'Faster / lighter on daily token quota',
  },
  {
    id: 'llama-3.1-70b-versatile',
    label: 'Llama 3.1 70B Versatile',
    hint: 'Previous 70B generation',
  },
  {
    id: 'gemma2-9b-it',
    label: 'Gemma 2 9B IT',
    hint: 'Compact instruction-tuned model',
  },
] as const;

export type GroqChatModelId = (typeof GROQ_CHAT_MODELS)[number]['id'];

const ALLOWED = new Set<string>(GROQ_CHAT_MODELS.map((m) => m.id));

export function isAllowedGroqModel(model: string): model is GroqChatModelId {
  return ALLOWED.has(model);
}

export function assertAllowedGroqModel(model: string, field: string): GroqChatModelId {
  if (!isAllowedGroqModel(model)) {
    throw new Error(
      `${field} must be a supported Groq model. Allowed: ${GROQ_CHAT_MODELS.map((m) => m.id).join(', ')}`
    );
  }
  return model;
}
