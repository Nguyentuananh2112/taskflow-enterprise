import { Router } from 'express';

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
  gitSha: string;
  probes: readonly ReadinessProbe[];
  isShuttingDown: () => boolean;
}

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
 * `/healthz` (liveness — không chạm DB/Valkey) và `/readyz` (readiness) theo devops.md §6.2.
 * Không qua rate limit, không lộ chi tiết lỗi. Body thô (không envelope) cho LB/Docker.
 */
export function healthRouter(options: HealthOptions): Router {
  const router = Router();

  router.get('/healthz', (_req, res) => {
    res.set('Cache-Control', 'no-store').json({ status: 'ok', gitSha: options.gitSha });
  });

  router.get('/readyz', async (_req, res) => {
    const results = await Promise.all(
      options.probes.map(async (probe) => [probe.name, await runProbe(probe)] as const),
    );
    const shuttingDown = options.isShuttingDown();
    const ready = !shuttingDown && results.every(([, status]) => status !== 'down');
    res
      .status(ready ? 200 : 503)
      .set('Cache-Control', 'no-store')
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
