import type { AddressInfo } from 'node:net';

import { Router } from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { FakeClock, SpyLogger } from '../../../test/support';
import { createApp } from '../../app';
import { ResourceConflictError } from '../errors';
import { createLogger } from '../logging/pino-logger';
import { AppMetrics, startMetricsServer } from './metrics';
import type { IErrorReporter } from './sentry';

const ID = '0199e5a2-7c1e-7cc3-9a3b-000000000001';

function appWith(metrics: AppMetrics, reporter?: IErrorReporter) {
  const things = Router({ mergeParams: true });
  things.get('/', (_req, res) => {
    res.json({ ok: true });
  });
  things.get('/:thingId', (_req, res) => {
    res.json({ ok: true });
  });
  things.get('/:thingId/conflict', () => {
    throw new ResourceConflictError({ reason: 'test' });
  });
  things.get('/:thingId/crash', () => {
    throw new Error('boom');
  });
  return createApp({
    config: {
      gitSha: 'sha',
      corsOrigins: [],
      trustProxyHops: 0,
      production: true,
      hsts: false,
      bodyLimit: '1kb',
    },
    logger: createLogger({ level: 'silent', gitSha: 'sha', appEnv: 'test' }),
    clock: new FakeClock('2026-10-15T08:00:00.000Z'),
    probes: [],
    isShuttingDown: () => false,
    routers: [{ path: '/workspaces/:wsId/things', router: things }],
    metrics,
    ...(reporter ? { errorReporter: reporter } : {}),
  });
}

describe('metrics HTTP (T-035 mục 3)', () => {
  it('nhãn route là MẪU (không id thật, không query); route không khớp ⇒ "unmatched"; lỗi đếm theo code', async () => {
    const metrics = new AppMetrics({ defaultMetrics: false });
    const app = appWith(metrics);
    await request(app).get(`/api/v1/workspaces/${ID}/things/${ID}?q=mia@example.com`);
    await request(app).get(`/api/v1/workspaces/${ID}/things`);
    await request(app).get(`/api/v1/workspaces/${ID}/things/${ID}/conflict`);
    await request(app).get(`/api/v1/nope/${ID}`);
    const text = await metrics.registry.metrics();
    expect(text).toContain(
      'http_request_duration_seconds_count{route="/api/v1/workspaces/:wsId/things/:thingId",method="GET",status="200"} 1',
    );
    expect(text).toContain(
      'http_request_duration_seconds_count{route="/api/v1/workspaces/:wsId/things",method="GET",status="200"} 1',
    );
    expect(text).toContain('route="unmatched",method="GET",status="404"');
    expect(text).toContain('http_errors_total{code="RESOURCE_CONFLICT"} 1');
    expect(text).toContain('http_errors_total{code="RESOURCE_NOT_FOUND"} 1');
    expect(text).not.toContain(ID);
    expect(text).not.toContain('mia@example.com');
  });

  it('Sentry chỉ nhận lỗi 5xx (devops.md §6.3) — 4xx không báo', async () => {
    const captured: unknown[] = [];
    const reporter: IErrorReporter = {
      capture: (e) => void captured.push(e),
      close: () => Promise.resolve(),
    };
    const app = appWith(new AppMetrics({ defaultMetrics: false }), reporter);
    await request(app).get(`/api/v1/workspaces/${ID}/things/${ID}/conflict`);
    await request(app).get(`/api/v1/nope`);
    expect(captured).toEqual([]);
    await request(app).get(`/api/v1/workspaces/${ID}/things/${ID}/crash`);
    expect(captured).toEqual([expect.objectContaining({ message: 'boom' })]);
  });

  it('job bảo trì: đếm theo kết quả, thời điểm thành công gần nhất; gauge đọc lúc scrape', async () => {
    const metrics = new AppMetrics({ defaultMetrics: false });
    let connected = 3;
    metrics.gauge('socketio_connected_clients', 'socket', () => connected);
    metrics.recordJobRun('workspace-purge', true, new Date('2026-10-15T08:00:00Z'));
    metrics.recordJobRun('workspace-purge', false);
    connected = 5;
    const text = await metrics.registry.metrics();
    expect(text).toContain('scheduled_job_runs_total{job="workspace-purge",result="success"} 1');
    expect(text).toContain('scheduled_job_runs_total{job="workspace-purge",result="failure"} 1');
    expect(text).toContain(
      'scheduled_job_last_success_timestamp{job="workspace-purge"} 1792051200',
    );
    expect(text).toContain('socketio_connected_clients 5');
  });

  it('counter() một nhãn (ADR-115: realtime_quota_fallback_total{kind})', async () => {
    const metrics = new AppMetrics({ defaultMetrics: false });
    const inc = metrics.counter('realtime_quota_fallback_total', 'fallback', 'kind');
    inc('socket');
    inc('socket');
    inc('join');
    const text = await metrics.registry.metrics();
    expect(text).toContain('realtime_quota_fallback_total{kind="socket"} 2');
    expect(text).toContain('realtime_quota_fallback_total{kind="join"} 1');
  });
});

describe('cổng metrics nội bộ', () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => close?.());

  async function serve(token?: string) {
    const metrics = new AppMetrics();
    const server = await startMetricsServer({
      port: 0,
      host: '127.0.0.1',
      registry: metrics.registry,
      token,
      logger: new SpyLogger(),
    });
    close = () => new Promise((resolve) => server.close(() => resolve()));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  it('GET /metrics ⇒ định dạng Prometheus (kèm metric mặc định của process); đường dẫn/method khác ⇒ 404', async () => {
    const base = await serve();
    const res = await fetch(`${base}/metrics`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    expect(await res.text()).toContain('process_cpu_user_seconds_total');
    expect((await fetch(`${base}/`)).status).toBe(404);
    expect((await fetch(`${base}/metrics`, { method: 'POST' })).status).toBe(404);
  });

  it('có METRICS_TOKEN ⇒ bắt buộc Bearer đúng (401 khi thiếu/sai)', async () => {
    const token = 'm'.repeat(32);
    const base = await serve(token);
    expect((await fetch(`${base}/metrics`)).status).toBe(401);
    const wrong = await fetch(`${base}/metrics`, {
      headers: { Authorization: `Bearer ${'x'.repeat(32)}` },
    });
    expect(wrong.status).toBe(401);
    const ok = await fetch(`${base}/metrics`, { headers: { Authorization: `Bearer ${token}` } });
    expect(ok.status).toBe(200);
  });
});
