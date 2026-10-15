import { Router } from 'express';

import { ipKey } from './rate-limit/rate-limit';
import { SlidingWindow } from './rate-limit/sliding-window';

export interface ReadinessProbe {
  /** Tên khóa trong body `/readyz`, vd `db`, `valkey`. */
  readonly name: string;
  /** `true` ⇒ lỗi làm `/readyz` trả 503; `false` ⇒ chỉ báo `degraded` (ADR-074: Valkey). */
  readonly critical: boolean;
  readonly timeoutMs: number;
  check(): Promise<void>;
}

export type ProbeStatus = 'ok' | 'down' | 'degraded';

export interface HealthOptions {
  probes: readonly ReadinessProbe[];
  isShuttingDown: () => boolean;
  /** Đồng hồ (ms) — chỉ để test. */
  now?: () => number;
}

/** Kết quả probe được dùng lại trong cửa sổ này (M2 của T-028). */
export const READINESS_CACHE_MS = 1_000;
/**
 * Hạn mức `/readyz` theo IP, đếm trong bộ nhớ (readiness không được phụ thuộc Valkey). LB / Docker
 * kiểm vài giây một lần ⇒ xa ngưỡng; chặn ở edge vẫn là lớp chính (devops.md §6.2).
 */
export const READINESS_LIMIT = { windowMs: 60_000, limit: 60 } as const;

type ProbeResults = readonly (readonly [string, ProbeStatus])[];

async function runProbe(probe: ReadinessProbe): Promise<ProbeStatus> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${probe.name} timeout`)), probe.timeoutMs);
  });
  try {
    await Promise.race([probe.check(), timeout]);
    return 'ok';
  } catch {
    return probe.critical ? 'down' : 'degraded';
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `/healthz` (liveness — không chạm DB/Valkey, không lộ gitSha) và `/readyz` (readiness) theo
 * devops.md §6.2. Không lộ chi tiết lỗi. Body thô (không envelope) cho LB/Docker.
 *
 * `/readyz` (M2 của T-028): kết quả probe dùng chung trong `READINESS_CACHE_MS` — mọi request trong
 * cửa sổ (kể cả đang chờ) chung MỘT lần kiểm DB/Valkey; cờ shutdown luôn đọc mới. Vượt
 * `READINESS_LIMIT` theo IP ⇒ 429 + `Retry-After`.
 */
export function healthRouter(options: HealthOptions): Router {
  const router = Router();
  const now = options.now ?? Date.now;
  const limiter = new SlidingWindow(READINESS_LIMIT);
  let cached: { at: number; results: Promise<ProbeResults> } | undefined;

  const probeResults = (): Promise<ProbeResults> => {
    const at = now();
    if (cached && at - cached.at < READINESS_CACHE_MS) return cached.results;
    const results = Promise.all(
      options.probes.map(async (probe) => [probe.name, await runProbe(probe)] as const),
    );
    cached = { at, results };
    return results;
  };

  router.get('/healthz', (_req, res) => {
    res.set('Cache-Control', 'no-store').json({ status: 'ok' });
  });

  router.get('/readyz', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!limiter.tryHit(ipKey(req.ip), now())) {
      res
        .status(429)
        .set('Retry-After', String(Math.ceil(READINESS_LIMIT.windowMs / 1000)))
        .json({ status: 'rate_limited' });
      return;
    }
    const results = await probeResults();
    const shuttingDown = options.isShuttingDown();
    const ready = !shuttingDown && results.every(([, status]) => status !== 'down');
    res
      .status(ready ? 200 : 503)
      .json({ ...Object.fromEntries(results), ...(shuttingDown ? { shuttingDown: true } : {}) });
  });

  return router;
}

/** Probe DB: `SELECT 1` trên pool dùng chung. */
export function databaseProbe(db: { query(sql: string): Promise<unknown> }): ReadinessProbe {
  return {
    name: 'db',
    critical: true,
    timeoutMs: 1_000,
    check: async () => void (await db.query('SELECT 1')),
  };
}

/** Probe Valkey: chưa sẵn sàng ⇒ degraded ngay, không chờ timeout. */
export function valkeyProbe(client: { isReady: boolean; ping(): Promise<string> }): ReadinessProbe {
  return {
    name: 'valkey',
    critical: false,
    timeoutMs: 500,
    check: async () => {
      if (!client.isReady) throw new Error('valkey not ready');
      await client.ping();
    },
  };
}
