export interface HumanizedError {
  title: string;
  reason: string;
  provider: string | null;
  model: string | null;
  code: string | null;
  recommendations: Array<'retry' | 'switch_provider' | 'enable_scheduler' | 'schedule_topic' | 'wait' | 'check_settings'>;
  raw: string;
}

function tryParseJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  // Full JSON blob
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      /* fall through */
    }
  }
  // Embedded JSON after a prefix
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  return null;
}

function dig(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function collectText(obj: unknown): string {
  if (typeof obj === 'string') return obj;
  if (!obj || typeof obj !== 'object') return '';
  const parts: string[] = [];
  const walk = (v: unknown, depth: number) => {
    if (depth > 4 || v == null) return;
    if (typeof v === 'string') {
      parts.push(v);
      return;
    }
    if (typeof v === 'object') {
      for (const val of Object.values(v as Record<string, unknown>)) walk(val, depth + 1);
    }
  };
  walk(obj, 0);
  return parts.join(' ');
}

export function humanizeError(rawInput: string | null | undefined): HumanizedError | null {
  if (!rawInput?.trim()) return null;
  const raw = rawInput.trim();
  const parsed = tryParseJson(raw);
  const blob = collectText(parsed) || raw;
  const lower = blob.toLowerCase();

  const provider =
    asString(dig(parsed, ['error', 'provider'])) ||
    asString(dig(parsed, ['provider'])) ||
    (lower.includes('groq') ? 'Groq' : lower.includes('openai') ? 'OpenAI' : lower.includes('anthropic') ? 'Anthropic' : lower.includes('openrouter') ? 'OpenRouter' : null);

  const model =
    asString(dig(parsed, ['error', 'model'])) ||
    asString(dig(parsed, ['model'])) ||
    (() => {
      const m = blob.match(/model['":\s]+([a-z0-9._/-]+)/i);
      return m?.[1] ?? null;
    })();

  const code =
    asString(dig(parsed, ['error', 'code'])) ||
    asString(dig(parsed, ['error', 'type'])) ||
    asString(dig(parsed, ['code'])) ||
    (lower.includes('rate_limit') || lower.includes('429') ? 'rate_limit_exceeded' : null);

  const message =
    asString(dig(parsed, ['error', 'message'])) ||
    asString(dig(parsed, ['message'])) ||
    raw;

  if (
    code === 'rate_limit_exceeded' ||
    lower.includes('rate_limit') ||
    lower.includes('rate limit') ||
    /\b429\b/.test(blob)
  ) {
    const isTokens = lower.includes('tokens per day') || lower.includes('tpd') || lower.includes('token');
    return {
      title: isTokens ? 'AI token limit reached' : 'AI rate limit reached',
      reason: isTokens
        ? 'The provider rejected the request because the daily token quota was exceeded.'
        : 'The provider rejected the request due to too many requests in a short window.',
      provider,
      model,
      code: code || 'rate_limit_exceeded',
      recommendations: ['wait', 'retry', 'switch_provider'],
      raw,
    };
  }

  if (lower.includes('missing_calendar') || lower.includes('no approved topic') || lower.includes('calendar')) {
    if (lower.includes('no ') || lower.includes('missing') || lower.includes('inactive')) {
      return {
        title: 'No topic scheduled for today',
        reason: message.length < 220 ? message : 'Today’s calendar entry is missing an approved topic.',
        provider,
        model,
        code: code || 'missing_calendar',
        recommendations: ['schedule_topic'],
        raw,
      };
    }
  }

  if (lower.includes('api key') || lower.includes('unauthorized') || lower.includes('invalid_api_key') || /\b401\b/.test(blob)) {
    return {
      title: 'Provider authentication failed',
      reason: 'The AI provider rejected the API key. Check Settings → AI Providers.',
      provider,
      model,
      code: code || 'auth_error',
      recommendations: ['switch_provider', 'check_settings'],
      raw,
    };
  }

  if (lower.includes('timeout') || lower.includes('etimedout') || lower.includes('aborted')) {
    return {
      title: 'Request timed out',
      reason: 'The AI call took too long and was aborted. Retrying often succeeds.',
      provider,
      model,
      code: code || 'timeout',
      recommendations: ['retry', 'switch_provider'],
      raw,
    };
  }

  if (lower.includes('quality') || lower.includes('review failed') || lower.includes('gate')) {
    return {
      title: 'Review quality gate failed',
      reason: message.length < 220 ? message : 'The draft did not meet review thresholds.',
      provider,
      model,
      code: code || 'quality_gate',
      recommendations: ['retry', 'check_settings'],
      raw,
    };
  }

  // Generic fallback — still humanized, never show JSON as title
  const short = message.replace(/\s+/g, ' ').slice(0, 160);
  return {
    title: 'Pipeline step failed',
    reason: short.includes('{') ? 'An unexpected provider or pipeline error occurred. See technical details below.' : short,
    provider,
    model,
    code,
    recommendations: ['retry', 'check_settings'],
    raw,
  };
}

export function extractErrorFromStageDetail(detail: string | null | undefined): string | null {
  if (!detail?.trim()) return null;
  if (detail.includes('{') || /error|failed|429|rate_limit/i.test(detail)) return detail;
  return null;
}
