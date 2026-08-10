import { useEffect, useRef, useState } from 'react';
import { api, getAuthToken } from '../api';
import { normalizeJobPayload, type DraftJobView } from './types';

/**
 * Subscribe to a draft job via SSE with 3s polling fallback.
 */
export function useJobSubscription(jobId: number | null, enabled = true) {
  const [job, setJob] = useState<DraftJobView | null>(null);
  const [transport, setTransport] = useState<'sse' | 'poll' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!jobId || !enabled) return;

    let cancelled = false;
    setError(null);

    const apply = (raw: Record<string, unknown>) => {
      if (cancelled) return;
      setJob(normalizeJobPayload(raw));
    };

    const startPoll = () => {
      setTransport('poll');
      const tick = async () => {
        try {
          const data = await api.get<{ job: Record<string, unknown> }>(
            `/api/editorial/jobs/${jobId}`
          );
          apply(data.job);
          const status = String(data.job.status || '');
          if (status === 'completed' || status === 'failed') {
            if (pollRef.current) clearInterval(pollRef.current);
          }
        } catch (err) {
          if (!cancelled) setError(err instanceof Error ? err.message : 'Poll failed');
        }
      };
      void tick();
      pollRef.current = setInterval(() => void tick(), 3000);
    };

    const token = getAuthToken();
    // EventSource cannot set Authorization; rely on cookie session + token query fallback
    const url = token
      ? `/api/editorial/jobs/${jobId}/events?access_token=${encodeURIComponent(token)}`
      : `/api/editorial/jobs/${jobId}/events`;

    try {
      const es = new EventSource(url, { withCredentials: true });
      esRef.current = es;
      let gotEvent = false;

      const onPayload = (ev: MessageEvent) => {
        gotEvent = true;
        setTransport('sse');
        try {
          const data = JSON.parse(String(ev.data)) as Record<string, unknown>;
          apply(data);
        } catch {
          /* ignore */
        }
      };

      es.addEventListener('snapshot', onPayload);
      es.addEventListener('progress', onPayload);
      es.addEventListener('done', (ev) => {
        onPayload(ev as MessageEvent);
        es.close();
      });
      es.onerror = () => {
        es.close();
        esRef.current = null;
        if (!gotEvent && !cancelled) startPoll();
        else if (!cancelled && !pollRef.current) startPoll();
      };
    } catch {
      startPoll();
    }

    return () => {
      cancelled = true;
      esRef.current?.close();
      esRef.current = null;
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [jobId, enabled]);

  return { job, transport, error, setJob };
}
