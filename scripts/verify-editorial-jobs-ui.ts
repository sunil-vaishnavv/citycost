/**
 * Browser-side regression for the /admin/topics "Aw, Snap! Out of Memory" crash.
 *
 * Mounts the real JobsProvider + GenerationDrawer + useJobSubscription in jsdom
 * against an in-memory fake of the /api/editorial/jobs API and EventSource.
 *
 * Root cause covered: the provider's terminal-job effect wrote `jobs`, which
 * re-ran the effect forever (~45k renders/s with any completed job listed).
 *
 * Usage: npx tsx scripts/verify-editorial-jobs-ui.ts
 */
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// ── DOM globals (must exist before React / app modules load) ─────────────────
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/admin/topics',
  pretendToBeVisual: true,
});
const g = globalThis as Record<string, unknown>;
for (const key of ['window', 'document', 'navigator', 'sessionStorage', 'localStorage', 'HTMLElement', 'Node', 'MouseEvent', 'KeyboardEvent', 'CustomEvent']) {
  Object.defineProperty(g, key, { value: (dom.window as unknown as Record<string, unknown>)[key], configurable: true, writable: true });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Fake jobs API ─────────────────────────────────────────────────────────────
type FakeJob = { id: number; job_type: string; status: string; topic_id: number; progress: Record<string, unknown> };
const api = {
  jobs: new Map<number, FakeJob>(),
  nextId: 5000,
  calls: [] as string[],
  listExcludes: new Set<number>(),
  jobGetFailuresLeft: 0,
  heavy: false,
  reset() {
    this.jobs.clear();
    this.calls = [];
    this.listExcludes.clear();
    this.jobGetFailuresLeft = 0;
    this.heavy = false;
  },
  count(prefix: string) {
    return this.calls.filter((c) => c.startsWith(prefix)).length;
  },
};

function progressFor(job: Partial<FakeJob> & { topic_id: number }, status: string, pct: number): Record<string, unknown> {
  const base: Record<string, unknown> = {
    topic_id: job.topic_id,
    topic_title: `Topic ${job.topic_id}`,
    stage: status === 'completed' ? 'completed' : status === 'failed' ? 'failed' : 'writing_sections',
    stage_label: status === 'completed' ? 'Completed' : 'Writing Sections',
    progress_pct: pct,
    eta_seconds: 10,
    stages: [{ id: 'writing_sections', label: 'Writing Sections', status: status === 'running' ? 'active' : 'done' }],
    logs: Array.from({ length: api.heavy ? 400 : 3 }, (_, i) => ({ t: new Date(1700000000000 + i).toISOString(), level: 'info', message: `log ${i}` })),
    metrics: {},
  };
  if (status === 'completed') base.article_id = 9000 + Number(job.topic_id);
  if (api.heavy) {
    // What an un-compacted (old) server shipped: retry cache + full Writer debug.
    base.cache = { research_pack: { blob: 'r'.repeat(256 * 1024) } };
    base.debug = { writer_v2: { audit: 'a'.repeat(128 * 1024) }, validation_failures: ['x'], before_score: 50 };
  }
  return base;
}

function addJob(topic_id: number, status: string, id = api.nextId++): FakeJob {
  const job: FakeJob = { id, job_type: 'draft_generate', status, topic_id, progress: {} };
  job.progress = progressFor(job, status, status === 'running' ? 40 : 100);
  api.jobs.set(id, job);
  return job;
}
function serialize(j: FakeJob) {
  return { id: j.id, job_type: j.job_type, status: j.status, progress: j.progress, error_message: j.status === 'failed' ? 'boom' : null, article_id: (j.progress.article_id as number) ?? null, topic_id: j.topic_id, topic_title: `Topic ${j.topic_id}` };
}
const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as unknown as Response;

g.fetch = async (input: string, init?: RequestInit) => {
  const url = String(input);
  const method = (init?.method || 'GET').toUpperCase();
  api.calls.push(`${method} ${url}`);
  await sleep(5);
  if (method === 'GET' && url.startsWith('/api/editorial/jobs?')) {
    const list = [...api.jobs.values()].filter((j) => !api.listExcludes.has(j.id)).sort((a, b) => b.id - a.id).slice(0, 30);
    return json({ jobs: list.map(serialize) });
  }
  const one = url.match(/^\/api\/editorial\/jobs\/(\d+)$/);
  if (method === 'GET' && one) {
    if (api.jobGetFailuresLeft > 0) {
      api.jobGetFailuresLeft--;
      return json({ error: 'The request timed out. Please try again.' }, 504);
    }
    const j = api.jobs.get(Number(one[1]));
    return j ? json({ job: serialize(j) }) : json({ error: 'Job not found' }, 404);
  }
  if (method === 'POST' && url === '/api/editorial/articles/generate') {
    await sleep(30); // network latency window for duplicate clicks
    const topic_id = Number(JSON.parse(String(init?.body || '{}')).topic_id);
    const existing = [...api.jobs.values()].find((j) => j.topic_id === topic_id && (j.status === 'queued' || j.status === 'running'));
    if (existing) return json({ ok: true, jobId: existing.id, status: existing.status, message: 'already running' }, 202);
    const job = addJob(topic_id, 'running');
    return json({ ok: true, jobId: job.id, status: 'queued', message: 'queued' }, 202);
  }
  const retry = url.match(/^\/api\/editorial\/jobs\/(\d+)\/retry$/);
  if (method === 'POST' && retry) {
    await sleep(30);
    const prior = api.jobs.get(Number(retry[1]))!;
    const job = addJob(prior.topic_id, 'running');
    return json({ ok: true, jobId: job.id, status: 'queued', message: 'queued' }, 202);
  }
  return json({});
};

// ── Fake EventSource ──────────────────────────────────────────────────────────
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  closed = false;
  onerror: ((ev: unknown) => void) | null = null;
  private listeners = new Map<string, Array<(ev: { data: string }) => void>>();
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: (ev: { data: string }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) || []), fn]);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data: unknown) {
    if (this.closed) return;
    for (const fn of this.listeners.get(type) || []) fn({ data: JSON.stringify(data) });
  }
  fail() {
    this.onerror?.({});
  }
  static forJob(id: number) {
    return [...FakeEventSource.instances].reverse().find((e) => e.url.includes(`/jobs/${id}/events`));
  }
}
g.EventSource = FakeEventSource;

// ── Harness ───────────────────────────────────────────────────────────────────
type Ctx = ReturnType<typeof import('../src/components/editorial/jobs/JobsProvider')['useEditorialJobs']>;

async function main() {
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { flushSync } = await import('react-dom');
  const { JobsProvider, useEditorialJobs } = await import('../src/components/editorial/jobs/JobsProvider');
  const { loadTrackedJobIds } = await import('../src/components/editorial/jobs/types');

  let renders = 0;
  let ctx: Ctx | null = null;
  function Probe() {
    ctx = useEditorialJobs() as unknown as Ctx;
    renders++;
    return null;
  }

  let root: ReturnType<typeof createRoot> | null = null;
  const mount = () => {
    const el = document.getElementById('root')!;
    root = createRoot(el);
    flushSync(() => root!.render(React.createElement(JobsProvider, null, React.createElement(Probe))));
  };
  const unmount = () => {
    root?.unmount();
    root = null;
  };
  const text = () => document.body.textContent || '';
  const waitFor = async (pred: () => boolean, label: string, ms = 3000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (pred()) return;
      await sleep(10);
    }
    assert.fail(`timeout waiting for: ${label}`);
  };

  let passed = 0;
  const test = async (name: string, fn: () => Promise<void>) => {
    api.reset();
    FakeEventSource.instances = [];
    sessionStorage.clear();
    renders = 0;
    ctx = null;
    try {
      await fn();
    } finally {
      unmount();
    }
    passed++;
    console.log(`  ✓ ${name}`);
  };

  console.log('verify-editorial-jobs-ui');

  await test('no render loop when completed/failed jobs are listed (root cause)', async () => {
    for (let i = 0; i < 29; i++) addJob(100 + i, i % 5 === 0 ? 'failed' : 'completed', 100 + i);
    mount();
    await waitFor(() => (ctx?.jobs.length ?? 0) === 29, 'jobs hydrate');
    const afterHydrate = renders;
    await sleep(500);
    assert.ok(renders - afterHydrate <= 1, `idle renders after hydrate: ${renders - afterHydrate}`);
    assert.ok(renders < 10, `total renders ${renders}`);
    assert.equal(api.count('GET /api/editorial/jobs?'), 1, 'single list fetch on mount');
  });

  await test('normal single generation: SSE progress → done, one toast, one notify', async () => {
    mount();
    await waitFor(() => api.count('GET /api/editorial/jobs?') >= 1, 'hydrate');
    const terminal: number[] = [];
    ctx!.subscribeJobTerminal((j) => terminal.push(j.id));
    const res = await ctx!.enqueueGenerate(1);
    assert.ok(res.ok && res.jobId);
    const jobId = res.jobId!;
    await waitFor(() => !!FakeEventSource.forJob(jobId), 'drawer subscribes');
    const es = FakeEventSource.forJob(jobId)!;
    const job = api.jobs.get(jobId)!;
    es.emit('snapshot', serialize(job));
    for (let pct = 50; pct <= 90; pct += 10) {
      job.progress = progressFor(job, 'running', pct);
      es.emit('progress', serialize(job));
    }
    await waitFor(() => text().includes('90%'), 'drawer shows progress');
    job.status = 'completed';
    job.progress = progressFor(job, 'completed', 100);
    es.emit('done', serialize(job));
    await waitFor(() => text().includes('Draft ready'), 'drawer completed');
    await waitFor(() => text().includes('Draft Ready'), 'toast');
    await sleep(200);
    assert.deepEqual(terminal, [jobId], 'terminal subscribers notified exactly once');
    assert.equal(text().split('Draft Ready').length - 1, 1, 'one toast');
    assert.ok(es.closed, 'SSE closed after done');
    assert.ok(text().includes('Open article'));
  });

  await test('duplicate Generate clicks → one POST, one job, drawer on that job', async () => {
    mount();
    await waitFor(() => api.count('GET /api/editorial/jobs?') >= 1, 'hydrate');
    const results = await Promise.all([ctx!.enqueueGenerate(7), ctx!.enqueueGenerate(7), ctx!.enqueueGenerate(7)]);
    assert.equal(api.count('POST /api/editorial/articles/generate'), 1, 'single POST');
    assert.equal(new Set(results.map((r) => r.jobId)).size, 1, 'same job id');
    assert.equal(api.jobs.size, 1, 'one job created');
    await waitFor(() => ctx!.drawerJobId === results[0].jobId, 'drawer opened on the job');
    // A later click after the first settled reuses the server's active job (no new job).
    await ctx!.enqueueGenerate(7);
    assert.equal(api.jobs.size, 1);
  });

  await test('large payloads: heavy research/debug fields never reach client state', async () => {
    api.heavy = true;
    for (let i = 0; i < 30; i++) addJob(200 + i, 'completed', 200 + i);
    mount();
    await waitFor(() => (ctx?.jobs.length ?? 0) === 30, 'hydrate');
    for (const j of ctx!.jobs) {
      const p = j.progress as unknown as Record<string, unknown>;
      assert.equal(p.cache, undefined, 'no retry cache in state');
      assert.ok(p.logs && (p.logs as unknown[]).length <= 100, 'logs capped');
      const d = p.debug as Record<string, unknown> | undefined;
      assert.ok(!d || d.writer_v2 === undefined, 'writer debug dropped');
    }
    // Raw fixture ≈ 30 × 384KB ≈ 11.5MB; state keeps only display fields (≤100 log lines/job).
    const stateBytes = JSON.stringify(ctx!.jobs).length;
    const rawBytes = JSON.stringify([...api.jobs.values()].map(serialize)).length;
    assert.ok(rawBytes > 10_000_000, `fixture size ${rawBytes}`);
    assert.ok(stateBytes < 400_000, `state size ${stateBytes}`);
  });

  await test('SSE failure + timeout → poll fallback, readable error, stops at terminal', async () => {
    mount();
    await waitFor(() => api.count('GET /api/editorial/jobs?') >= 1, 'hydrate');
    const { jobId } = await ctx!.enqueueGenerate(3);
    await waitFor(() => !!FakeEventSource.forJob(jobId!), 'sse');
    api.jobGetFailuresLeft = 1; // first poll times out (504)
    FakeEventSource.forJob(jobId!)!.fail();
    await waitFor(() => text().includes('timed out'), 'readable error shown', 2000);
    const job = api.jobs.get(jobId!)!;
    job.status = 'completed';
    job.progress = progressFor(job, 'completed', 100);
    await waitFor(() => text().includes('Draft ready'), 'poll picks up completion', 5000);
    assert.ok(!text().includes('timed out'), 'error clears after recovery');
    const polls = api.count(`GET /api/editorial/jobs/${jobId}`);
    await sleep(3500);
    assert.equal(api.count(`GET /api/editorial/jobs/${jobId}`), polls, 'polling stopped after terminal');
    assert.equal(FakeEventSource.instances.filter((e) => e.url.includes(`/jobs/${jobId}/`)).length, 1, 'no SSE reconnect storm');
  });

  await test('navigate away mid-job and back: cleanup, reconnect, no duplicate job', async () => {
    mount();
    await waitFor(() => api.count('GET /api/editorial/jobs?') >= 1, 'hydrate');
    const { jobId } = await ctx!.enqueueGenerate(11);
    await waitFor(() => !!FakeEventSource.forJob(jobId!), 'sse');
    const es = FakeEventSource.forJob(jobId!)!;
    assert.deepEqual(loadTrackedJobIds(), [jobId], 'job tracked for reconnect');

    // In-app route change closes the drawer (and its stream).
    window.history.pushState({}, '', '/admin/articles');
    window.dispatchEvent(new window.PopStateEvent('popstate'));
    await waitFor(() => ctx!.drawerJobId === null, 'drawer closed on route change');
    assert.ok(es.closed, 'stream closed on route change');

    // Full reload / remount while the job is still running and outside the list window.
    unmount();
    const callsAtUnmount = api.calls.length;
    await sleep(300);
    assert.equal(api.calls.length, callsAtUnmount, 'no requests after unmount');
    api.listExcludes.add(jobId!);
    window.history.pushState({}, '', '/admin/topics');
    mount();
    await waitFor(() => api.count(`GET /api/editorial/jobs/${jobId}`) >= 1, 'tracked job reconnected');
    await waitFor(() => ctx!.jobs.some((j) => j.id === jobId), 'job back in menu');
    ctx!.openDrawer(jobId!);
    await waitFor(() => FakeEventSource.instances.filter((e) => e.url.includes(`/jobs/${jobId}/`)).length === 2, 'drawer resubscribes');
    assert.equal(api.count('POST /api/editorial/articles/generate'), 1, 'no duplicate POST');
    assert.equal(api.jobs.size, 1, 'no duplicate job');
  });

  await test('retry: concurrent retries dedupe to one POST', async () => {
    const failed = addJob(21, 'failed');
    mount();
    await waitFor(() => (ctx?.jobs.length ?? 0) === 1, 'hydrate');
    await Promise.all([ctx!.retryJob(failed.id), ctx!.retryJob(failed.id)]);
    assert.equal(api.count(`POST /api/editorial/jobs/${failed.id}/retry`), 1);
    assert.equal(api.jobs.size, 2);
  });

  await test('repeated jobs: state, toasts and tracking stay bounded', async () => {
    mount();
    await waitFor(() => api.count('GET /api/editorial/jobs?') >= 1, 'hydrate');
    for (let i = 0; i < 40; i++) {
      const { jobId } = await ctx!.enqueueGenerate(500 + i);
      await waitFor(() => !!FakeEventSource.forJob(jobId!), `sse ${i}`);
      const job = api.jobs.get(jobId!)!;
      job.status = 'completed';
      job.progress = progressFor(job, 'completed', 100);
      FakeEventSource.forJob(jobId!)!.emit('done', serialize(job));
      await waitFor(() => ctx!.jobs.some((j) => j.id === jobId && j.status === 'completed'), `done ${i}`);
    }
    await ctx!.refreshJobs();
    await sleep(100);
    assert.ok(ctx!.jobs.length <= 30, `jobs in state ${ctx!.jobs.length}`);
    assert.ok(loadTrackedJobIds().length <= 20, 'tracked ids bounded');
    const toastCount = text().split('Draft Ready').length - 1;
    assert.ok(toastCount <= 4, `toasts ${toastCount}`);
    assert.ok(renders < 40 * 25, `renders ${renders} for 40 jobs`);
    const openStreams = FakeEventSource.instances.filter((e) => !e.closed).length;
    assert.ok(openStreams <= 1, `open streams ${openStreams}`);
  });

  console.log(`\n${passed} passed`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
