import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  Eye,
  EyeOff,
  PlugZap,
  RefreshCw,
  Save,
  Shield,
} from 'lucide-react';
import { api, ApiError } from './api';
import {
  Badge,
  Button,
  Callout,
  Card,
  Field,
  GlassPanel,
  Input,
  PageLoader,
  SectionHeader,
  Select,
  Tabs,
  Toggle,
} from './ui';

interface ProviderCard {
  id: number;
  provider_name: string;
  label: string;
  env_key?: string | null;
  enabled: boolean;
  priority: number;
  api_key_masked: string | null;
  default_model: string | null;
  models: string[];
  temperature: number;
  top_p: number;
  max_output_tokens: number;
  max_input_tokens: number;
  context_window: number;
  rpm_limit: number | null;
  tpm_limit: number | null;
  daily_limit: number | null;
  monthly_limit: number | null;
  fallback_provider: string | null;
  status: string;
  status_color: 'green' | 'yellow' | 'red';
  last_tested_at: string | null;
  last_used_at: string | null;
  last_error: string | null;
  avg_latency_ms: number | null;
  avg_cost_usd: number | null;
  supports_json: boolean;
  supports_streaming: boolean;
  supports_long_context: boolean;
  requests_today: number;
  failures_today: number;
  success_rate: number;
  token_usage: number;
  /** Models list came from the provider's live API (not the offline defaults). */
  live_models?: boolean;
  /** false when the saved default model is no longer offered by the provider. */
  default_model_available?: boolean | null;
  meta?: {
    fallback_models?: string[];
    auto_model_fallback?: boolean;
    auto_model?: { model: string; from: string | null; reason: string; at: string } | null;
  };
}

type ProviderDraft = Partial<ProviderCard> & {
  api_key?: string;
  auto_model_fallback?: boolean;
  fallback_models_text?: string;
};

interface UsageSummary {
  total_requests: number;
  success_rate: number;
  failure_rate: number;
  avg_latency_ms: number;
  avg_tokens: number;
  avg_cost_usd: number;
  retry_count: number;
  by_provider: Array<{
    provider: string;
    requests: number;
    successes: number;
    failures: number;
    avg_latency_ms: number;
    tokens: number;
    cost_usd: number;
  }>;
  by_model: Array<{ model: string; requests: number }>;
  daily: Array<{ day: string; requests: number; successes: number; failures: number }>;
}

type TabKey = 'providers' | 'usage';

const STATUS_DOT: Record<string, string> = {
  green: 'bg-emerald-500',
  yellow: 'bg-amber-400',
  red: 'bg-rose-500',
};

export default function AiProvidersPanel() {
  const [tab, setTab] = useState<TabKey>('providers');
  const [providers, setProviders] = useState<ProviderCard[]>([]);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [drafts, setDrafts] = useState<Record<string, ProviderDraft>>({});
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, unknown>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [p, u] = await Promise.all([
        api.get<{ providers: ProviderCard[] }>('/api/editorial/ai/providers'),
        api.get<{ summary: UsageSummary }>('/api/editorial/ai/usage?days=7'),
      ]);
      setProviders(p.providers || []);
      setUsage(u.summary);
      const next: typeof drafts = {};
      for (const prov of p.providers || []) {
        next[prov.provider_name] = {
          enabled: prov.enabled,
          priority: prov.priority,
          default_model: prov.default_model,
          temperature: prov.temperature,
          top_p: prov.top_p,
          max_output_tokens: prov.max_output_tokens,
          rpm_limit: prov.rpm_limit,
          tpm_limit: prov.tpm_limit,
          daily_limit: prov.daily_limit,
          api_key: '',
          auto_model_fallback: prov.meta?.auto_model_fallback !== false,
          fallback_models_text: (prov.meta?.fallback_models || []).join(', '),
        };
      }
      setDrafts(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load AI providers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const patchDraft = (name: string, patch: ProviderDraft) => {
    setDrafts((prev) => ({ ...prev, [name]: { ...prev[name], ...patch } }));
  };

  const saveProvider = async (name: string) => {
    setBusy(`save:${name}`);
    setMessage('');
    setError('');
    try {
      const d = drafts[name] || {};
      const body: Record<string, unknown> = {
        enabled: d.enabled,
        priority: d.priority,
        default_model: d.default_model,
        temperature: d.temperature,
        top_p: d.top_p,
        max_output_tokens: d.max_output_tokens,
        rpm_limit: d.rpm_limit,
        tpm_limit: d.tpm_limit,
        daily_limit: d.daily_limit,
        auto_model_fallback: d.auto_model_fallback !== false,
        fallback_models: (d.fallback_models_text || '')
          .split(',')
          .map((m) => m.trim())
          .filter(Boolean),
      };
      if (d.api_key && d.api_key.trim()) body.api_key = d.api_key.trim();
      const res = await api.patch<{ message: string }>(`/api/editorial/ai/providers/${name}`, body);
      setMessage(res.message || 'Saved');
      patchDraft(name, { api_key: '' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setBusy(null);
    }
  };

  const resetAutoModel = async (name: string) => {
    setBusy(`reset:${name}`);
    setError('');
    try {
      await api.patch(`/api/editorial/ai/providers/${name}`, { reset_auto_model: true });
      setMessage(`${name}: automatic model switch cleared — the default model is tried first again`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Reset failed');
    } finally {
      setBusy(null);
    }
  };

  const testProvider = async (name: string) => {
    setBusy(`test:${name}`);
    setError('');
    try {
      const res = await api.post<{ result: Record<string, unknown> }>(
        `/api/editorial/ai/providers/${name}/test`
      );
      setTestResult((prev) => ({ ...prev, [name]: res.result }));
      setMessage(`${name}: ${(res.result as { message?: string }).message || 'tested'}`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Test failed');
    } finally {
      setBusy(null);
    }
  };

  if (loading && !providers.length) {
    return <PageLoader label="Loading AI providers…" />;
  }

  return (
    <div className="space-y-5">
      <SectionHeader
        eyebrow="AI Platform"
        title="AI Providers"
        description="Multi-provider routing with automatic failover. API keys sync both ways with .env (GROQ / GEMINI / OPENAI / DEEPSEEK / OPENROUTER / ANTHROPIC)."
        actions={
          <Button size="sm" variant="outline" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => void load()}>
            Refresh
          </Button>
        }
      />

      <GlassPanel padding="p-0">
        <Tabs
          items={[
            { key: 'providers', label: 'Providers' },
            { key: 'usage', label: 'Usage Analytics' },
          ]}
          active={tab}
          onChange={(k) => setTab(k as TabKey)}
          className="px-4"
        />
        <div className="p-5">
          {message && <Callout tone="emerald" className="mb-4">{message}</Callout>}
          {error && <Callout tone="rose" className="mb-4">{error}</Callout>}

          {tab === 'usage' && usage && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label="Total Requests" value={usage.total_requests} />
                <Stat label="Success Rate" value={`${usage.success_rate}%`} />
                <Stat label="Failure Rate" value={`${usage.failure_rate}%`} />
                <Stat label="Avg Latency" value={`${usage.avg_latency_ms} ms`} />
                <Stat label="Avg Tokens" value={usage.avg_tokens} />
                <Stat label="Avg Cost" value={`$${usage.avg_cost_usd}`} />
                <Stat label="Retries" value={usage.retry_count} />
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <Card padding="p-4">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                    Provider distribution
                  </p>
                  <ul className="mt-2 space-y-2 text-sm">
                    {usage.by_provider.map((p) => (
                      <li key={p.provider} className="flex justify-between gap-2">
                        <span className="capitalize text-slate-700 dark:text-slate-200">{p.provider}</span>
                        <span className="text-slate-500">
                          {p.requests} req · {p.tokens} tok · ${p.cost_usd}
                        </span>
                      </li>
                    ))}
                    {!usage.by_provider.length && (
                      <li className="text-slate-400">No usage logged yet.</li>
                    )}
                  </ul>
                </Card>
                <Card padding="p-4">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                    Most used models
                  </p>
                  <ul className="mt-2 space-y-2 text-sm">
                    {usage.by_model.map((m) => (
                      <li key={m.model} className="flex justify-between gap-2">
                        <span className="truncate font-mono text-xs text-slate-700 dark:text-slate-200">
                          {m.model}
                        </span>
                        <span className="text-slate-500">{m.requests}</span>
                      </li>
                    ))}
                    {!usage.by_model.length && (
                      <li className="text-slate-400">No model usage yet.</li>
                    )}
                  </ul>
                </Card>
              </div>
              <Card padding="p-4">
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                  Daily usage (7d)
                </p>
                <div className="mt-2 space-y-1.5">
                  {usage.daily.map((d) => (
                    <div key={d.day} className="flex items-center gap-3 text-xs">
                      <span className="w-24 text-slate-500">{d.day}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-white/5">
                        <div
                          className="h-full rounded-full bg-teal-500"
                          style={{
                            width: `${Math.min(100, usage.total_requests ? (d.requests / Math.max(...usage.daily.map((x) => x.requests), 1)) * 100 : 0)}%`,
                          }}
                        />
                      </div>
                      <span className="w-28 text-right text-slate-500">
                        {d.successes}/{d.requests} ok
                      </span>
                    </div>
                  ))}
                  {!usage.daily.length && <p className="text-slate-400 text-sm">No daily data yet.</p>}
                </div>
              </Card>
            </div>
          )}

          {tab === 'providers' && (
            <div className="grid gap-4 xl:grid-cols-2">
              {providers.map((p) => {
                const d = drafts[p.provider_name] || {};
                const tr = testResult[p.provider_name] as
                  | {
                      ok?: boolean;
                      latencyMs?: number;
                      models?: string[];
                      contextWindow?: number;
                      supportsJson?: boolean;
                      supportsStreaming?: boolean;
                      rpm?: number;
                      tpm?: number;
                      status?: string;
                      message?: string;
                    }
                  | undefined;
                return (
                  <Card key={p.provider_name} padding="p-4" className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`h-2.5 w-2.5 rounded-full ${STATUS_DOT[p.status_color] || STATUS_DOT.yellow}`}
                          />
                          <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
                            {p.label}
                          </h3>
                          <Badge tone="neutral">{p.status}</Badge>
                        </div>
                        <p className="mt-1 text-[11px] text-slate-400">
                          Priority {d.priority ?? p.priority} ·{' '}
                          <code className="rounded bg-slate-100 px-1 dark:bg-white/10">
                            {p.env_key || 'ENV'}
                          </code>{' '}
                          ↔ admin sync
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-500">Enabled</span>
                        <Toggle
                          checked={Boolean(d.enabled)}
                          onChange={(v) => patchDraft(p.provider_name, { enabled: v })}
                        />
                      </div>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2">
                      <Field label="Priority">
                        <Input
                          type="number"
                          value={String(d.priority ?? p.priority)}
                          onChange={(e) =>
                            patchDraft(p.provider_name, { priority: Number(e.target.value) })
                          }
                        />
                      </Field>
                      <Field label="Default model">
                        <Select
                          value={d.default_model || p.default_model || ''}
                          onChange={(e) =>
                            patchDraft(p.provider_name, { default_model: e.target.value })
                          }
                        >
                          {[
                            ...(p.default_model && !(p.models || []).includes(p.default_model)
                              ? [p.default_model]
                              : []),
                            ...(p.models || []),
                          ].map((m) => (
                            <option key={m} value={m}>
                              {m}
                              {m === p.default_model && p.default_model_available === false ? ' (no longer offered)' : ''}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field
                        label="Auto-switch model on errors"
                        hint="If a model is retired, rate-limited, out of credits or overloaded, the next model is tried automatically."
                      >
                        <Toggle
                          checked={d.auto_model_fallback !== false}
                          onChange={(v) => patchDraft(p.provider_name, { auto_model_fallback: v })}
                        />
                      </Field>
                      <Field
                        label="Fallback models (in order)"
                        hint={`Comma-separated. ${p.live_models ? 'Choose from the live list below.' : 'Live list unavailable — using built-in list.'}`}
                      >
                        <Input
                          list={`models-${p.provider_name}`}
                          placeholder="e.g. model-a, model-b"
                          value={d.fallback_models_text || ''}
                          onChange={(e) =>
                            patchDraft(p.provider_name, { fallback_models_text: e.target.value })
                          }
                        />
                        <datalist id={`models-${p.provider_name}`}>
                          {(p.models || []).slice(0, 200).map((m) => (
                            <option key={m} value={m} />
                          ))}
                        </datalist>
                      </Field>
                      {(p.default_model_available === false || p.meta?.auto_model) && (
                        <div className="sm:col-span-2 rounded-lg border border-amber-200/80 bg-amber-50/70 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300">
                          {p.default_model_available === false && (
                            <p>
                              Default model <code>{p.default_model}</code> is no longer offered by {p.label}.
                            </p>
                          )}
                          {p.meta?.auto_model && (
                            <p className="mt-1">
                              Auto-switched to <code>{p.meta.auto_model.model}</code>
                              {p.meta.auto_model.from ? ` (from ${p.meta.auto_model.from})` : ''} on{' '}
                              {new Date(p.meta.auto_model.at).toLocaleString()} — {p.meta.auto_model.reason}
                              <Button
                                size="sm"
                                variant="outline"
                                className="ml-2"
                                loading={busy === `reset:${p.provider_name}`}
                                onClick={() => void resetAutoModel(p.provider_name)}
                              >
                                Reset
                              </Button>
                            </p>
                          )}
                        </div>
                      )}
                      <Field
                        label="API key"
                        hint="Synced with .env — Save writes encrypted DB + env file. Leave blank to keep current."
                      >
                        <div className="flex gap-2">
                          <Input
                            type={showKey[p.provider_name] ? 'text' : 'password'}
                            autoComplete="off"
                            placeholder={p.api_key_masked || 'Paste API key (or set in .env)'}
                            value={d.api_key || ''}
                            onChange={(e) =>
                              patchDraft(p.provider_name, { api_key: e.target.value })
                            }
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            icon={
                              showKey[p.provider_name] ? (
                                <EyeOff className="h-3.5 w-3.5" />
                              ) : (
                                <Eye className="h-3.5 w-3.5" />
                              )
                            }
                            onClick={() =>
                              setShowKey((s) => ({
                                ...s,
                                [p.provider_name]: !s[p.provider_name],
                              }))
                            }
                          />
                        </div>
                        {p.api_key_masked && (
                          <p className="mt-1 font-mono text-[11px] text-slate-500">
                            Current: {p.api_key_masked}
                          </p>
                        )}
                      </Field>
                      <Field label="Temperature">
                        <Input
                          type="number"
                          step={0.05}
                          value={String(d.temperature ?? p.temperature)}
                          onChange={(e) =>
                            patchDraft(p.provider_name, { temperature: Number(e.target.value) })
                          }
                        />
                      </Field>
                      <Field label="Top P">
                        <Input
                          type="number"
                          step={0.05}
                          value={String(d.top_p ?? p.top_p)}
                          onChange={(e) =>
                            patchDraft(p.provider_name, { top_p: Number(e.target.value) })
                          }
                        />
                      </Field>
                      <Field label="Max output tokens">
                        <Input
                          type="number"
                          value={String(d.max_output_tokens ?? p.max_output_tokens)}
                          onChange={(e) =>
                            patchDraft(p.provider_name, {
                              max_output_tokens: Number(e.target.value),
                            })
                          }
                        />
                      </Field>
                      <Field label="RPM limit">
                        <Input
                          type="number"
                          value={String(d.rpm_limit ?? p.rpm_limit ?? '')}
                          onChange={(e) =>
                            patchDraft(p.provider_name, {
                              rpm_limit: e.target.value === '' ? null : Number(e.target.value),
                            })
                          }
                        />
                      </Field>
                      <Field label="TPM limit">
                        <Input
                          type="number"
                          value={String(d.tpm_limit ?? p.tpm_limit ?? '')}
                          onChange={(e) =>
                            patchDraft(p.provider_name, {
                              tpm_limit: e.target.value === '' ? null : Number(e.target.value),
                            })
                          }
                        />
                      </Field>
                      <Field label="Daily limit">
                        <Input
                          type="number"
                          value={String(d.daily_limit ?? p.daily_limit ?? '')}
                          onChange={(e) =>
                            patchDraft(p.provider_name, {
                              daily_limit: e.target.value === '' ? null : Number(e.target.value),
                            })
                          }
                        />
                      </Field>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-500 dark:text-slate-400 sm:grid-cols-4">
                      <span>Requests today: {p.requests_today}</span>
                      <span>Failures today: {p.failures_today}</span>
                      <span>Success: {p.success_rate}%</span>
                      <span>Tokens today: {p.token_usage}</span>
                      <span>Avg latency: {p.avg_latency_ms != null ? `${Math.round(p.avg_latency_ms)}ms` : '—'}</span>
                      <span>Avg cost: {p.avg_cost_usd != null ? `$${p.avg_cost_usd}` : '—'}</span>
                      <span>Last used: {p.last_used_at ? new Date(p.last_used_at).toLocaleString() : '—'}</span>
                      <span>Last tested: {p.last_tested_at ? new Date(p.last_tested_at).toLocaleString() : '—'}</span>
                    </div>

                    {tr && (
                      <Callout tone={tr.ok ? 'emerald' : 'rose'}>
                        <div className="space-y-0.5 text-xs">
                          <p className="font-semibold">{tr.ok ? 'Connected' : 'Failed'} — {tr.message}</p>
                          <p>Latency: {tr.latencyMs}ms · Context: {tr.contextWindow?.toLocaleString()}</p>
                          <p>
                            JSON: {tr.supportsJson ? 'yes' : 'no'} · Streaming:{' '}
                            {tr.supportsStreaming ? 'yes' : 'no'} · RPM {tr.rpm ?? '—'} · TPM{' '}
                            {tr.tpm ?? '—'}
                          </p>
                          {tr.models?.length ? (
                            <p className="truncate">Models: {tr.models.slice(0, 4).join(', ')}</p>
                          ) : null}
                        </div>
                      </Callout>
                    )}

                    {p.last_error && (
                      <p className="text-[11px] text-rose-500 line-clamp-2">{p.last_error}</p>
                    )}

                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button
                        size="sm"
                        variant="primary"
                        icon={<Save className="h-3.5 w-3.5" />}
                        loading={busy === `save:${p.provider_name}`}
                        onClick={() => void saveProvider(p.provider_name)}
                      >
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        icon={<PlugZap className="h-3.5 w-3.5" />}
                        loading={busy === `test:${p.provider_name}`}
                        onClick={() => void testProvider(p.provider_name)}
                      >
                        Test Connection
                      </Button>
                      <Badge tone={p.supports_json ? 'emerald' : 'neutral'}>
                        <Shield className="mr-1 inline h-3 w-3" />
                        JSON {p.supports_json ? 'on' : 'off'}
                      </Badge>
                      <Badge tone="sky">
                        <Activity className="mr-1 inline h-3 w-3" />
                        ctx {p.context_window.toLocaleString()}
                      </Badge>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </GlassPanel>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <Card padding="p-3">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 font-display text-xl font-bold text-slate-900 dark:text-white">{value}</p>
    </Card>
  );
}
