import { useCallback, useEffect, useState } from 'react';
import { Eye, EyeOff, KeyRound, Lock, Pencil, RefreshCw, Save, X } from 'lucide-react';
import { api, ApiError, type EditorialSettings, type GroqAiStatus, type GroqModelOption } from './api';
import AiProvidersPanel from './AiProvidersPanel';
import {
  Button,
  Callout,
  Card,
  Divider,
  Field,
  GlassPanel,
  Input,
  PageLoader,
  SectionHeader,
  Select,
  Tabs,
  Toggle,
} from './ui';

const FALLBACK_GROQ_MODELS: GroqModelOption[] = [
  { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B (Groq)' },
  { id: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B (Groq, faster)' },
  { id: 'qwen/qwen3.8-27b', label: 'Qwen 3.8 27B (Groq)' },
];

type SettingsTab =
  | 'general'
  | 'ai'
  | 'providers'
  | 'publishing'
  | 'seo'
  | 'automation'
  | 'refresh'
  | 'security';

const TABS: Array<{ key: SettingsTab; label: string }> = [
  { key: 'general', label: 'General' },
  { key: 'ai', label: 'AI' },
  { key: 'providers', label: 'AI Providers' },
  { key: 'publishing', label: 'Publishing' },
  { key: 'seo', label: 'SEO' },
  { key: 'automation', label: 'Automation' },
  { key: 'refresh', label: 'Refresh' },
  { key: 'security', label: 'Security' },
];

function numberField(
  settings: EditorialSettings,
  set: (patch: Partial<EditorialSettings>) => void,
  key: keyof EditorialSettings,
  opts: { step?: number; min?: number; max?: number } = {}
) {
  return (
    <Input
      type="number"
      step={opts.step ?? 1}
      min={opts.min}
      max={opts.max}
      value={String(settings[key] ?? '')}
      onChange={(e) => set({ [key]: Number(e.target.value) } as Partial<EditorialSettings>)}
    />
  );
}

export default function SettingsPanel() {
  const [settings, setSettings] = useState<EditorialSettings | null>(null);
  const [groq, setGroq] = useState<GroqAiStatus | null>(null);
  const [tab, setTab] = useState<SettingsTab>('general');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [editingKey, setEditingKey] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');

  const loadGroq = useCallback(async () => {
    try {
      const groqResult = await api.get<GroqAiStatus>('/api/editorial/ai/groq');
      setGroq(groqResult);
      if (!editingKey) {
        setKeyDraft(groqResult.api_key || '');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load Groq key');
    }
  }, [editingKey]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [settingsResult, groqResult] = await Promise.all([
        api.get<{ settings: EditorialSettings }>('/api/editorial/settings'),
        api.get<GroqAiStatus>('/api/editorial/ai/groq'),
      ]);
      setSettings(settingsResult.settings);
      setGroq(groqResult);
      if (!editingKey) {
        setKeyDraft(groqResult.api_key || '');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, [editingKey]);

  useEffect(() => {
    void load();
  }, [load]);

  // Sync panel when `.env` changes (tab focus / polling while AI tab is open).
  useEffect(() => {
    if (tab !== 'ai' || editingKey) return;
    void loadGroq();
    const onFocus = () => {
      void loadGroq();
    };
    window.addEventListener('focus', onFocus);
    const timer = window.setInterval(() => {
      void loadGroq();
    }, 4000);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.clearInterval(timer);
    };
  }, [tab, editingKey, loadGroq]);

  const patch = (update: Partial<EditorialSettings>) => {
    setSettings((prev) => (prev ? { ...prev, ...update } : prev));
  };

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    setMessage('');
    setError('');
    try {
      const result = await api.patch<{ settings: EditorialSettings }>('/api/editorial/settings', settings);
      setSettings(result.settings);
      setMessage('Settings saved successfully');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const saveGroqKey = async () => {
    setSavingKey(true);
    setMessage('');
    setError('');
    try {
      const result = await api.put<GroqAiStatus>('/api/editorial/ai/groq', { api_key: keyDraft });
      setGroq(result);
      setKeyDraft(result.api_key || '');
      setEditingKey(false);
      setShowKey(false);
      setMessage(result.message || 'GROQ_API_KEY updated in .env and applied live');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update GROQ_API_KEY');
    } finally {
      setSavingKey(false);
    }
  };

  const groqModels = groq?.models?.length ? groq.models : FALLBACK_GROQ_MODELS;
  const lockedDisplayValue = showKey
    ? groq?.api_key || ''
    : groq?.masked_key || (groq?.configured ? '••••••••' : '');
  const fieldValue = editingKey ? keyDraft : lockedDisplayValue;

  if (loading && !settings) {
    return <PageLoader label="Loading settings…" />;
  }

  if (!settings) {
    return <Callout tone="rose">{error || 'Settings unavailable.'}</Callout>;
  }

  return (
    <div className="space-y-5">
      <SectionHeader
        eyebrow="Configuration"
        title="Settings"
        description="Tune the writer, reviewer, publishing cadence, and quality gates that power the editorial engine."
        actions={
          tab === 'providers' ? null : (
            <>
              <Button size="sm" variant="outline" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => void load()}>
                Reload
              </Button>
              <Button size="sm" variant="primary" icon={<Save className="h-3.5 w-3.5" />} loading={saving} onClick={() => void save()}>
                Save Changes
              </Button>
            </>
          )
        }
      />

      {/* Shared tab strip for all settings views */}
      <GlassPanel padding="p-0" className={tab === 'providers' ? 'overflow-visible' : ''}>
        <Tabs items={TABS} active={tab} onChange={(k) => setTab(k as SettingsTab)} className="px-4" />
      </GlassPanel>

      {tab === 'providers' ? (
        <AiProvidersPanel />
      ) : (
        <>
      {message && <Callout tone="emerald">{message}</Callout>}
      {error && <Callout tone="rose">{error}</Callout>}

      <GlassPanel padding="p-0">
        <div className="p-5">
          {tab === 'general' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Language">
                <Input value={settings.language} onChange={(e) => patch({ language: e.target.value })} />
              </Field>
              <Field label="Reading level">
                <Select value={settings.reading_level} onChange={(e) => patch({ reading_level: e.target.value })}>
                  <option value="general">General</option>
                  <option value="intermediate">Intermediate</option>
                  <option value="advanced">Advanced</option>
                </Select>
              </Field>
              <Field label="Articles per day">{numberField(settings, patch, 'articles_per_day', { min: 0, max: 10 })}</Field>
              <Field label="Session TTL (hours)">{numberField(settings, patch, 'session_ttl_hours', { min: 1, max: 168 })}</Field>
              <Field label="Session idle timeout (minutes)">
                {numberField(settings, patch, 'session_idle_timeout_minutes', { min: 5, max: 1440 })}
              </Field>
            </div>
          )}

          {tab === 'ai' && (
            <div className="space-y-5">
              <Callout tone="sky">
                Multi-provider routing, failover, and usage analytics live under{' '}
                <button
                  type="button"
                  className="font-semibold underline underline-offset-2"
                  onClick={() => setTab('providers')}
                >
                  Settings → AI Providers
                </button>
                . This tab keeps the legacy Groq `.env` key editor for backward compatibility.
              </Callout>
              <Card padding="p-4" className="bg-slate-50 dark:bg-white/[0.03]">
                <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                      <Lock className="h-4 w-4" />
                    </span>
                    <div className="text-sm">
                      <p className="font-semibold text-slate-800 dark:text-slate-100">Groq API key</p>
                      <p className="mt-1 text-slate-500 dark:text-slate-400">
                        Two-way sync with <code className="rounded bg-slate-200 px-1 py-0.5 text-xs dark:bg-white/10">.env → GROQ_API_KEY</code>.
                        Field is locked until you click Edit. Use the eye to view the full key.
                      </p>
                      <p className="mt-2">
                        {groq?.configured ? (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                            Active
                          </span>
                        ) : (
                          <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
                            Missing
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  {!editingKey ? (
                    <Button
                      size="sm"
                      variant="outline"
                      icon={<Pencil className="h-3.5 w-3.5" />}
                      onClick={() => {
                        setEditingKey(true);
                        setShowKey(true);
                        setKeyDraft(groq?.api_key || '');
                      }}
                    >
                      Edit
                    </Button>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="primary"
                        icon={<Save className="h-3.5 w-3.5" />}
                        loading={savingKey}
                        onClick={() => void saveGroqKey()}
                      >
                        Save key
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        icon={<X className="h-3.5 w-3.5" />}
                        onClick={() => {
                          setEditingKey(false);
                          setShowKey(false);
                          setKeyDraft(groq?.api_key || '');
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  )}
                </div>

                <Field label="GROQ_API_KEY" hint={editingKey ? 'Editing — Save writes to .env and applies live' : 'Locked — click Edit to change'}>
                  <div className="flex gap-2">
                    <Input
                      type={editingKey ? (showKey ? 'text' : 'password') : 'text'}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={groq?.configured ? undefined : 'gsk_…'}
                      value={fieldValue}
                      readOnly={!editingKey}
                      disabled={!editingKey}
                      onChange={(e) => {
                        if (!editingKey) return;
                        setKeyDraft(e.target.value);
                      }}
                      className={!editingKey ? 'cursor-not-allowed opacity-80' : undefined}
                      onKeyDown={(e) => {
                        if (!editingKey) e.preventDefault();
                      }}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      icon={showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      onClick={() => setShowKey((v) => !v)}
                      aria-label={showKey ? 'Hide key' : 'Show full key'}
                      title={showKey ? 'Hide key' : 'Show full key'}
                    />
                  </div>
                </Field>
              </Card>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Provider">
                  <Input value="Groq" disabled readOnly />
                </Field>
                <Field label="Key source">
                  <Input value=".env ↔ admin panel (synced)" disabled readOnly />
                </Field>
                <Field label="Writer model" hint="Groq models only">
                  <Select
                    value={settings.writer_model}
                    onChange={(e) => patch({ writer_model: e.target.value })}
                  >
                    {groqModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Reviewer model" hint="Groq models only">
                  <Select
                    value={settings.reviewer_model}
                    onChange={(e) => patch({ reviewer_model: e.target.value })}
                  >
                    {groqModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Temperature" hint="0.0–1.0, higher = more creative">
                  {numberField(settings, patch, 'temperature', { step: 0.05, min: 0, max: 1 })}
                </Field>
                <Field label="Top P">{numberField(settings, patch, 'top_p', { step: 0.05, min: 0, max: 1 })}</Field>
                <Field label="Max tokens">{numberField(settings, patch, 'max_tokens', { step: 256, min: 256 })}</Field>
                <Field label="Max writer retries">{numberField(settings, patch, 'max_writer_retries', { min: 0, max: 5 })}</Field>
                <Field label="Max reviewer retries">{numberField(settings, patch, 'max_reviewer_retries', { min: 0, max: 5 })}</Field>
              </div>
              <Divider />
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                Self-healing revision (P4.5)
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Toggle
                  label="Enable auto revision"
                  description="After Review FAIL, automatically repair then re-review"
                  checked={Boolean(settings.auto_revision_enabled)}
                  onChange={(v) => patch({ auto_revision_enabled: v })}
                />
                <Toggle
                  label="Auto continue pipeline"
                  description="After a successful revision pass, continue SEO → publish"
                  checked={Boolean(settings.auto_revision_continue_pipeline)}
                  onChange={(v) => patch({ auto_revision_continue_pipeline: v })}
                />
                <Field label="Maximum revision attempts" hint="1–3 category revisions then needs_manual_review">
                  {numberField(settings, patch, 'max_revision_attempts', { min: 1, max: 3 })}
                </Field>
                <Field label="Quality threshold" hint="Used by Reviewer + Revision gate">
                  {numberField(settings, patch, 'quality_score_threshold', { min: 0, max: 100 })}
                </Field>
              </div>
            </div>
          )}

          {tab === 'publishing' && (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Publishing time (UTC)" hint="Format HH:MM">
                  <Input value={settings.publishing_time_utc} onChange={(e) => patch({ publishing_time_utc: e.target.value })} />
                </Field>
                <Field label="Timezone" hint="IANA timezone, e.g. Asia/Kolkata">
                  <Input value={settings.timezone} onChange={(e) => patch({ timezone: e.target.value })} />
                </Field>
              </div>
              <Divider />
              <div className="grid gap-3 sm:grid-cols-2">
                <Toggle
                  label="Scheduler enabled"
                  description="Allow the daily cron tick to fire"
                  checked={settings.scheduler_enabled}
                  onChange={(v) => patch({ scheduler_enabled: v })}
                />
                <Toggle
                  label="Auto-publish"
                  description="Publish automatically once SEO passes"
                  checked={settings.auto_publish}
                  onChange={(v) => patch({ auto_publish: v })}
                />
                <Toggle
                  label="Auto-publish on Excellent confidence"
                  description="When confidence is Excellent, allow auto-publish messaging"
                  checked={Boolean(settings.confidence_auto_publish_excellent)}
                  onChange={(v) => patch({ confidence_auto_publish_excellent: v })}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Confidence Excellent →">
                  <Select
                    value={String(settings.confidence_action_excellent || 'auto_publish')}
                    onChange={(e) =>
                      patch({
                        confidence_action_excellent: e.target.value as EditorialSettings['confidence_action_excellent'],
                      })
                    }
                  >
                    <option value="auto_publish">Auto publish</option>
                    <option value="ready">Ready</option>
                    <option value="review">Review</option>
                    <option value="manual">Manual</option>
                  </Select>
                </Field>
                <Field label="Confidence High →">
                  <Select
                    value={String(settings.confidence_action_high || 'ready')}
                    onChange={(e) =>
                      patch({
                        confidence_action_high: e.target.value as EditorialSettings['confidence_action_high'],
                      })
                    }
                  >
                    <option value="auto_publish">Auto publish</option>
                    <option value="ready">Ready</option>
                    <option value="review">Review</option>
                    <option value="manual">Manual</option>
                  </Select>
                </Field>
                <Field label="Confidence Medium →">
                  <Select
                    value={String(settings.confidence_action_medium || 'review')}
                    onChange={(e) =>
                      patch({
                        confidence_action_medium: e.target.value as EditorialSettings['confidence_action_medium'],
                      })
                    }
                  >
                    <option value="auto_publish">Auto publish</option>
                    <option value="ready">Ready</option>
                    <option value="review">Review</option>
                    <option value="manual">Manual</option>
                  </Select>
                </Field>
                <Field label="Confidence Low →">
                  <Select
                    value={String(settings.confidence_action_low || 'manual')}
                    onChange={(e) =>
                      patch({
                        confidence_action_low: e.target.value as EditorialSettings['confidence_action_low'],
                      })
                    }
                  >
                    <option value="auto_publish">Auto publish</option>
                    <option value="ready">Ready</option>
                    <option value="review">Review</option>
                    <option value="manual">Manual</option>
                  </Select>
                </Field>
              </div>
            </div>
          )}

          {tab === 'seo' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Quality score threshold">
                {numberField(settings, patch, 'quality_score_threshold', { min: 0, max: 100 })}
              </Field>
              <Field
                label="Duplicate threshold (critical)"
                hint="Manual review at ≥ this value (min 0.90). Warning band 0.90–threshold; below 0.90 ignored."
              >
                {numberField(settings, patch, 'duplicate_threshold', { step: 0.01, min: 0.9, max: 1 })}
              </Field>
              <Field label="Internal links (min)">{numberField(settings, patch, 'internal_link_min', { min: 0 })}</Field>
              <Field label="Internal links (max)">{numberField(settings, patch, 'internal_link_max', { min: 0 })}</Field>
              <Field label="Article length min (words)">{numberField(settings, patch, 'article_length_min', { min: 0, step: 50 })}</Field>
              <Field label="Article length target min">
                {numberField(settings, patch, 'article_length_target_min', { min: 0, step: 50 })}
              </Field>
              <Field label="Article length target max">
                {numberField(settings, patch, 'article_length_target_max', { min: 0, step: 50 })}
              </Field>
              <Field label="Article length max (words)">{numberField(settings, patch, 'article_length_max', { min: 0, step: 50 })}</Field>
            </div>
          )}

          {tab === 'automation' && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Toggle
                  label="Automation paused"
                  description="Pause the scheduler without disabling it"
                  checked={settings.automation_paused}
                  onChange={(v) => patch({ automation_paused: v })}
                />
                <Toggle
                  label="Sitemap ping"
                  description="Ping search engines after publishing"
                  checked={settings.sitemap_ping_enabled}
                  onChange={(v) => patch({ sitemap_ping_enabled: v })}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Automation retry count">{numberField(settings, patch, 'automation_retry_count', { min: 0, max: 10 })}</Field>
                <Field label="Strategy max topics per run">{numberField(settings, patch, 'strategy_max_candidates', { min: 1, max: 2, step: 1 })}</Field>
                <Field label="Freshness skip above">{numberField(settings, patch, 'freshness_skip_above', { min: 0, max: 100 })}</Field>
                <Field label="Freshness pure-data min">{numberField(settings, patch, 'freshness_pure_data_min', { min: 0, max: 100 })}</Field>
                <Field label="Freshness partial min">{numberField(settings, patch, 'freshness_partial_min', { min: 0, max: 100 })}</Field>
              </div>
            </div>
          )}

          {tab === 'refresh' && (
            <div className="space-y-4">
              <Toggle
                label="Content refresh enabled"
                description="Periodically refresh dynamic cost-data blocks in published articles"
                checked={settings.refresh_enabled}
                onChange={(v) => patch({ refresh_enabled: v })}
              />
              <Field label="Refresh cron" hint="Cron expression, e.g. 0 6 * * 0 (weekly Sunday 6am)">
                <Input value={settings.refresh_cron} onChange={(e) => patch({ refresh_cron: e.target.value })} />
              </Field>
            </div>
          )}

          {tab === 'security' && (
            <div className="space-y-4">
              <Card padding="p-4" className="bg-slate-50 dark:bg-white/[0.03]">
                <div className="flex items-start gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-slate-300">
                    <KeyRound className="h-4 w-4" />
                  </span>
                  <div className="text-sm">
                    <p className="font-semibold text-slate-800 dark:text-slate-100">Admin password</p>
                    <p className="mt-1 text-slate-500 dark:text-slate-400">
                      The editorial admin password is set via the <code className="rounded bg-slate-200 px-1 py-0.5 text-xs dark:bg-white/10">EDITORIAL_ADMIN_PASSWORD</code>{' '}
                      environment variable on the server. Update it there and restart the server to rotate credentials —
                      it cannot be changed from this UI.
                    </p>
                  </div>
                </div>
              </Card>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Session TTL (hours)" hint="Absolute session lifetime">
                  {numberField(settings, patch, 'session_ttl_hours', { min: 1, max: 168 })}
                </Field>
                <Field label="Session idle timeout (minutes)">
                  {numberField(settings, patch, 'session_idle_timeout_minutes', { min: 5, max: 1440 })}
                </Field>
              </div>
            </div>
          )}
        </div>
      </GlassPanel>
        </>
      )}
    </div>
  );
}
