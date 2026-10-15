import { timingSafeEqual } from 'node:crypto';
import { createServer, type Server } from 'node:http';

import type { RequestHandler } from 'express';
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';

import type { ILogger } from '../logging/logger';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- cách chuẩn mở rộng Request của Express
  namespace Express {
    interface Request {
      /** Mẫu đường dẫn nơi router được gắn (vd `/api/v1/workspaces`) — gắn bởi `markRouteBase`. */
      routeBase?: string;
    }
  }
}

/** Route không khớp router nào ⇒ một nhãn duy nhất (không để URL thật làm nổ cardinality). */
export const UNMATCHED_ROUTE = 'unmatched';

/**
 * Metrics tối thiểu (devops.md §6.4, T-035 mục 3). Registry riêng cho mỗi tiến trình (không dùng
 * registry toàn cục của prom-client ⇒ test tạo nhiều instance không đụng nhau). Nhãn route là MẪU
 * (`/api/v1/workspaces/:wsId/members`), không bao giờ là URL thật (id, query).
 */
export class AppMetrics {
  readonly registry = new Registry();
  readonly #httpDuration: Histogram<'route' | 'method' | 'status'>;
  readonly #errors: Counter<'code'>;
  readonly #jobRuns: Counter<'job' | 'result'>;
  readonly #jobLastSuccess: Gauge<'job'>;

  constructor(options: { defaultMetrics?: boolean } = {}) {
    if (options.defaultMetrics ?? true) collectDefaultMetrics({ register: this.registry });
    this.#httpDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'Thời gian xử lý request HTTP theo mẫu route',
      labelNames: ['route', 'method', 'status'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.15, 0.3, 0.5, 1, 2.5, 5],
      registers: [this.registry],
    });
    this.#errors = new Counter({
      name: 'http_errors_total',
      help: 'Response lỗi theo mã lỗi của envelope (ErrorCode)',
      labelNames: ['code'],
      registers: [this.registry],
    });
    this.#jobRuns = new Counter({
      name: 'scheduled_job_runs_total',
      help: 'Số lượt chạy job bảo trì theo kết quả (T-033)',
      labelNames: ['job', 'result'],
      registers: [this.registry],
    });
    this.#jobLastSuccess = new Gauge({
      name: 'scheduled_job_last_success_timestamp',
      help: 'Thời điểm (giây Unix) job bảo trì chạy thành công gần nhất (devops.md §7.4)',
      labelNames: ['job'],
      registers: [this.registry],
    });
  }

  /** Middleware đo request — gắn đầu chuỗi (sau requestLogging). */
  httpMetrics(): RequestHandler {
    return (req, res, next) => {
      const end = this.#httpDuration.startTimer();
      res.once('finish', () => {
        const leaf = (req.route as { path?: unknown } | undefined)?.path;
        const route =
          typeof leaf === 'string'
            ? `${req.routeBase ?? ''}${leaf === '/' ? '' : leaf}` || '/'
            : UNMATCHED_ROUTE;
        end({ route, method: req.method, status: String(res.statusCode) });
        const code = (res.locals as { errorCode?: unknown }).errorCode;
        if (typeof code === 'string') this.#errors.inc({ code });
      });
      next();
    };
  }

  /** Kết quả một lượt job bảo trì — dành cho scheduler của T-033. */
  recordJobRun(job: string, ok: boolean, at: Date = new Date()): void {
    this.#jobRuns.inc({ job, result: ok ? 'success' : 'failure' });
    if (ok) this.#jobLastSuccess.set({ job }, Math.floor(at.getTime() / 1000));
  }

  /** Gauge đọc lúc scrape (pool DB, số socket…) — `read` không được ném. */
  gauge(name: string, help: string, read: () => number): void {
    new Gauge({
      name,
      help,
      registers: [this.registry],
      collect() {
        this.set(read());
      },
    });
  }
}

/** Ghi mẫu đường dẫn mount của router — `createApp` gọi khi gắn từng router. */
export function markRouteBase(base: string): RequestHandler {
  return (req, _res, next) => {
    req.routeBase = base;
    next();
  };
}

export interface MetricsServerOptions {
  port: number;
  host: string;
  registry: Registry;
  /** Có ⇒ bắt buộc `Authorization: Bearer <token>` (lớp thứ hai nếu cổng lỡ bị lộ). */
  token?: string | undefined;
  logger: ILogger;
}

const sameSecret = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * `/metrics` (Prometheus) trên **cổng nội bộ riêng** — KHÔNG qua app Express công khai (T-035 mục 3).
 * Chỉ `GET /metrics`; mọi thứ khác 404. Không log mỗi lần scrape.
 */
export async function startMetricsServer(options: MetricsServerOptions): Promise<Server> {
  const server = createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0];
    if (req.method !== 'GET' || path !== '/metrics') {
      res.writeHead(404).end();
      return;
    }
    if (options.token !== undefined) {
      const header = req.headers.authorization ?? '';
      const presented = header.startsWith('Bearer ') ? header.slice(7) : '';
      if (!sameSecret(presented, options.token)) {
        res.writeHead(401, { 'WWW-Authenticate': 'Bearer' }).end();
        return;
      }
    }
    options.registry
      .metrics()
      .then((body) => {
        res.writeHead(200, {
          'Content-Type': options.registry.contentType,
          'Cache-Control': 'no-store',
        });
        res.end(body);
      })
      .catch((err: unknown) => {
        options.logger.error({ err }, 'metrics.collect_failed');
        res.writeHead(500).end();
      });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  return server;
}
