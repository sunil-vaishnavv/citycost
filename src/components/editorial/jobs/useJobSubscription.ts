import { useEffect, useState } from 'react';
import { api, getAuthToken } from '../api';
import { isTerminalJobStatus, normalizeJobPayload, sameJobView, type DraftJobView } from './types';

const POLL_MS = 3000;

/**
 * Subscribe to a draft job via SSE with 3s polling fallback.
 *
 * Lifecycle guarantees: one transport at a time, no overlapping poll requests,
 * everything stops once the job is terminal or the subscriber unmounts, and
 * identical frames do not trigger a re-render.
 */
export function useJobSubscription(jobId: number | null, enabled = true) {
  const [job, setJob] = useState<DraftJobView | null>(null);
  const [transport, setTransport] = useState<'sse' | 'poll' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId || !enabled) return;

    let cancelled = false;
    let terminal = false;
    let es: EventSource | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let pollInFlight = false;

    setError(null);
    // Drop a previous job's state when switching jobs (keep it when reopening the same job).
    setJob((prev) => (prev && prev.id === jobId ? prev : null));

    const stopPoll = () => {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
    };
    const closeStream = () => {
      es?.close();
      es = null;
    };

    const apply = (raw: Record<string, unknown>) => {
      if (cancelled) return;
      const next = normalizeJobPayload(raw);
      if (Number.isFinite(next.id) && next.id !== jobId) return;
      setJob((prev) => (sameJobView(prev, next) ? prev : next));
      if (isTerminalJobStatus(next.status)) {
        terminal = true;
        stopPoll();
        closeStream();
      }
    };

    const startPoll = () => {
      if (cancelled || terminal || pollTimer) return;
      setTransport('poll');
      const tick = async () => {
        if (pollInFlight || cancelled || terminal) return;
        pollInFlight = true;
        try {
          const data = await api.get<{ job: Record<string, unknown> }>(`/api/editorial/jobs/${jobId}`);
          if (cancelled) return;
          setError(null);
          apply(data.job);
        } catch (err) {
          if (!cancelled) setError(err instanceof Error ? err.message : 'Poll failed');
        } finally {
          pollInFlight = false;
        }
      };
      void tick();
      pollTimer = setInterval(() => void tick(), POLL_MS);
    };

    const token = getAuthToken();
    // EventSource cannot set Authorization; rely on cookie session + token query fallback
    const url = token
      ? `/api/editorial/jobs/${jobId}/events?access_token=${encodeURIComponent(token)}`
      : `/api/editorial/jobs/${jobId}/events`;

    try {
      const stream = new EventSource(url, { withCredentials: true });
      es = stream;

      const onPayload = (ev: MessageEvent) => {
        if (cancelled) return;
        setTransport('sse');
        try {
          apply(JSON.parse(String(ev.data)) as Record<string, unknown>);
        } catch {
          /* ignore malformed frame */
        }
      };

      stream.addEventListener('snapshot', onPayload as EventListener);
      stream.addEventListener('progress', onPayload as EventListener);
      stream.addEventListener('done', (ev) => {
        onPayload(ev as MessageEvent);
        terminal = true;
        closeStream();
      });
      stream.onerror = () => {
        // Close instead of letting EventSource auto-reconnect forever; poll until terminal.
        closeStream();
        if (!cancelled && !terminal) startPoll();
      };
    } catch {
      startPoll();
    }

    return () => {
      cancelled = true;
      closeStream();
      stopPoll();
    };
  }, [jobId, enabled]);

  return { job, transport, error, setJob };
}
