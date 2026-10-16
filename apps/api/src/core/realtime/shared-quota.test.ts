import { describe, expect, it } from 'vitest';

import { FakeClock, SpyLogger } from '../../../test/support';
import type { CommandSender } from '../http/rate-limit/store';
import { MAX_SOCKETS_PER_USER } from '../http/rate-limit/rules';
import { LocalRealtimeQuota } from './quota';
import { SharedRealtimeQuota, type QuotaFallbackKind } from './shared-quota';
import { HEARTBEAT_BATCH, HEARTBEAT_SCRIPT } from './shared-quota.scripts';

// ADR-115: phần không cần Valkey thật — Local kiểm trước, Valkey lỗi ⇒ rơi về Local, heartbeat theo lô.
// Lua chạy thật ở shared-quota.integration.test.ts.

class FakeValkey implements CommandSender {
  readonly calls: string[][] = [];
  failing = false;
  sendCommand(args: string[]): Promise<unknown> {
    this.calls.push(args);
    if (this.failing) return Promise.reject(new Error('ECONNREFUSED'));
    return Promise.resolve(args[0] === 'SCRIPT' ? 'sha' : 1);
  }
  evals(script: string) {
    return this.calls.filter((c) => c[0] === 'EVAL' && c[1] === script);
  }
}

function setup(failing = false) {
  const valkey = new FakeValkey();
  valkey.failing = failing;
  const logger = new SpyLogger();
  const fallbacks: QuotaFallbackKind[] = [];
  const quota = new SharedRealtimeQuota({
    valkey,
    local: new LocalRealtimeQuota(new FakeClock(new Date())),
    instanceId: 'inst-a',
    logger,
    onFallback: (k) => fallbacks.push(k),
    heartbeatMs: 0,
  });
  return { valkey, logger, fallbacks, quota };
}

describe('SharedRealtimeQuota (ADR-115)', () => {
  it('Local từ chối ⇒ không hỏi Valkey (trần theo instance luôn chạy trước)', async () => {
    const { valkey, quota } = setup();
    valkey.calls.length = 0;
    expect(await quota.acquireSocket('u1', MAX_SOCKETS_PER_USER)).toBe(false);
    expect(valkey.calls).toEqual([]);
  });

  it('Valkey lỗi ⇒ chỉ còn hạn mức Local: cho qua, metric MỖI lần, warn tối đa 1 lần/30 s mỗi loại', async () => {
    const { logger, fallbacks, quota } = setup(true);
    expect(await quota.acquireSocket('u1', 0)).toBe(true);
    expect(await quota.acquireSocket('u1', 1)).toBe(true);
    expect(await quota.tryJoin('u1')).toBe(true);
    expect(await quota.tryRenew('u1')).toBe(true);
    await quota.releaseSocket('u1');
    expect(fallbacks).toEqual(['socket', 'socket', 'join', 'renew', 'socket']);
    const warns = logger.entries.filter(
      (e) => e.msg === 'realtime.quota_shared_unavailable_local_only',
    );
    expect(warns.map((w) => (w.data as { kind: string }).kind)).toEqual([
      'socket',
      'join',
      'renew',
    ]);
    // Local vẫn chặn khi Valkey lỗi.
    expect(await quota.acquireSocket('u1', MAX_SOCKETS_PER_USER)).toBe(false);
  });

  it('heartbeat: một EVAL cho mỗi lô HEARTBEAT_BATCH user (không một lệnh mỗi user); user về 0 ⇒ gửi 0 một lần rồi thôi', async () => {
    const { valkey, quota } = setup();
    const counts = new Map(
      Array.from({ length: 2 * HEARTBEAT_BATCH + 1 }, (_, i) => [`u${i}`, 1] as const),
    );
    let current: ReadonlyMap<string, number> = counts;
    quota.start(() => current);
    await quota.heartbeat();
    const first = valkey.evals(HEARTBEAT_SCRIPT);
    expect(first.map((c) => Number(c[2]))).toEqual([HEARTBEAT_BATCH + 1, HEARTBEAT_BATCH + 1, 2]);

    current = new Map([['u0', 2]]); // mọi user khác vừa ngắt hết
    valkey.calls.length = 0;
    await quota.heartbeat();
    const second = valkey.evals(HEARTBEAT_SCRIPT);
    expect(second).toHaveLength(Math.ceil(counts.size / HEARTBEAT_BATCH));
    valkey.calls.length = 0;
    await quota.heartbeat();
    const third = valkey.evals(HEARTBEAT_SCRIPT);
    expect(third).toHaveLength(1);
    // KEYS: rt:instances + rt:sock:u0; ARGV: instanceId, ttl, prune, 2
    expect(third[0]!.slice(2, 5)).toEqual(['2', 'rt:instances', 'rt:sock:u0']);
    expect(third[0]!.at(-1)).toBe('2');
  });

  it('không có user nào ⇒ heartbeat vẫn ghi "còn sống" (một EVAL)', async () => {
    const { valkey, quota } = setup();
    quota.start(() => new Map());
    valkey.calls.length = 0;
    await quota.heartbeat();
    expect(valkey.evals(HEARTBEAT_SCRIPT)).toHaveLength(1);
  });
});
