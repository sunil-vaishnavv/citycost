import type { AiProviderAdapter, AiProviderName } from '../types.js';
import { anthropicProvider } from './anthropic.js';
import { deepseekProvider } from './deepseek.js';
import { geminiProvider } from './gemini.js';
import { groqProvider } from './groq.js';
import { openaiProvider } from './openai.js';
import { openrouterProvider } from './openrouter.js';

const REGISTRY: Record<AiProviderName, AiProviderAdapter> = {
  groq: groqProvider,
  gemini: geminiProvider,
  openai: openaiProvider,
  deepseek: deepseekProvider,
  openrouter: openrouterProvider,
  anthropic: anthropicProvider,
};

export function getProviderAdapter(name: AiProviderName): AiProviderAdapter {
  const adapter = REGISTRY[name];
  if (!adapter) throw new Error(`Provider adapter not registered: ${name}`);
  return adapter;
}

export function listProviderAdapters(): AiProviderAdapter[] {
  return Object.values(REGISTRY);
}

/**
 * Plugin hook — register a custom provider without touching Writer/Reviewer.
 */
export function registerProviderAdapter(adapter: AiProviderAdapter): void {
  REGISTRY[adapter.name] = adapter;
}
