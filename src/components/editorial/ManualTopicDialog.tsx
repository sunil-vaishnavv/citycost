import { useState, type FormEvent } from 'react';
import { ListTree, X } from 'lucide-react';
import { api, ApiError, type Topic } from './api';
import { Button, Callout, Field, Input, Select, Textarea } from './ui';

const CONTENT_TYPES = [
  'guide',
  'country_guide',
  'city_guide',
  'comparison_guide',
  'salary_guide',
  'rent_guide',
  'food_guide',
  'transportation_guide',
  'healthcare_guide',
  'tax_guide',
  'student_guide',
  'remote_worker_guide',
  'retirement_guide',
  'moving_guide',
  'budget_guide',
  'visa_guide',
];

export default function ManualTopicDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated?: (topic: Topic) => void;
}) {
  const [title, setTitle] = useState('');
  const [contentType, setContentType] = useState('guide');
  const [brief, setBrief] = useState('');
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('');
  const [comparison, setComparison] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await api.post<{ topic: Topic; topic_id: number }>(
        '/api/editorial/topics/manual',
        {
          title,
          content_type: contentType,
          brief: brief || undefined,
          city: city || undefined,
          country: country || undefined,
          comparison: comparison || undefined,
        }
      );
      onCreated?.(result.topic);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Create topic failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4 backdrop-blur-sm">
      <div className="editorial-fade-in w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-white/10 dark:bg-slate-950">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-white/10">
          <div className="flex items-center gap-2">
            <ListTree className="h-5 w-5 text-teal-600 dark:text-teal-400" />
            <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">Create Topic Manually</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={(e) => void submit(e)} className="space-y-4 px-5 py-5">
          <Field label="Topic / title">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Cost of living in Lisbon" />
          </Field>

          <Field label="Content type">
            <Select value={contentType} onChange={(e) => setContentType(e.target.value)}>
              {CONTENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, ' ')}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Content direction / brief">
            <Textarea
              rows={3}
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder="Optional notes for when you write the article"
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="City">
              <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Optional" />
            </Field>
            <Field label="Country">
              <Input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Optional" />
            </Field>
            <Field label="Comparison">
              <Input value={comparison} onChange={(e) => setComparison(e.target.value)} placeholder="Optional" />
            </Field>
          </div>

          {error && <Callout tone="rose">{error}</Callout>}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" variant="accent" loading={busy}>
              Create Topic
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
