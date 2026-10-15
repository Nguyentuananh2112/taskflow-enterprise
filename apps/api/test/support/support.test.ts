// Các fake dùng chung phải đúng hành vi — test của mọi module dựa vào chúng.
import { describe, expect, it } from 'vitest';

import { AfterCommitOutsideTransactionError } from '../../src/core/persistence/unit-of-work';
import {
  FakeClock,
  FakeRandom,
  FakeUnitOfWork,
  SequentialIdGenerator,
  SpyEventBus,
  SpyLogger,
  createSpy,
  integrationRequired,
  testValkeyUrl,
  type Snapshottable,
} from './index';

class InMemoryCounter implements Snapshottable {
  value = 0;
  snapshot(): unknown {
    return this.value;
  }
  restore(snapshot: unknown): void {
    this.value = snapshot as number;
  }
}

describe('FakeUnitOfWork', () => {
  it('commit: begin → commit, hook chạy sau commit; lồng nhau không mở transaction mới', async () => {
    const uow = new FakeUnitOfWork();
    const seen: string[] = [];
    await uow.run(() =>
      uow.run(() => {
        uow.afterCommit(() => void seen.push(`hook inTx=${uow.inTransaction}`));
        return Promise.resolve();
      }),
    );
    expect(uow.steps).toEqual(['begin', 'commit']);
    expect(seen).toEqual(['hook inTx=false']);
    expect(uow.commits).toBe(1);
  });

  it('lỗi ⇒ rollback snapshot của InMemory repo, hook không chạy, lỗi ném lại', async () => {
    const counter = new InMemoryCounter();
    const uow = new FakeUnitOfWork(counter);
    let hookRan = false;
    await expect(
      uow.run(() => {
        counter.value = 99;
        uow.afterCommit(() => void (hookRan = true));
        return Promise.reject(new Error('rule'));
      }),
    ).rejects.toThrow('rule');
    expect(counter.value).toBe(0);
    expect(uow.steps).toEqual(['begin', 'rollback']);
    expect(uow.rollbacks).toBe(1);
    expect(hookRan).toBe(false);
  });

  it('enlist sau khởi tạo; hook lỗi được giữ lại, không ném; afterCommit ngoài run ⇒ lỗi', async () => {
    const counter = new InMemoryCounter();
    const uow = new FakeUnitOfWork().enlist(counter);
    await uow.run(
      () => {
        counter.value = 1;
        uow.afterCommit(() => Promise.reject(new Error('socket')));
        return Promise.resolve();
      },
      { isolationLevel: 'Serializable' },
    );
    expect(counter.value).toBe(1);
    expect(uow.hookErrors).toHaveLength(1);
    expect(uow.runOptions).toEqual([{ isolationLevel: 'Serializable' }]);
    expect(() => uow.afterCommit(() => undefined)).toThrow(AfterCommitOutsideTransactionError);
  });
});

describe('FakeClock / SequentialIdGenerator / FakeRandom', () => {
  it('clock cố định, advance/set, trả bản sao Date', () => {
    const clock = new FakeClock('2026-11-01T00:00:00.000Z');
    const now = clock.now();
    now.setFullYear(2000);
    expect(clock.now().toISOString()).toBe('2026-11-01T00:00:00.000Z');
    clock.advance(1_000);
    expect(clock.now().toISOString()).toBe('2026-11-01T00:00:01.000Z');
    clock.set('2027-01-01T00:00:00.000Z');
    expect(clock.now().getUTCFullYear()).toBe(2027);
    expect(new FakeClock().now().toISOString()).toBe('2026-10-15T08:00:00.000Z');
  });

  it('id tuần tự đúng dạng uuid v7', () => {
    const ids = new SequentialIdGenerator();
    expect([ids.next(), ids.next()]).toEqual([
      '00000000-0000-7000-8000-000000000001',
      '00000000-0000-7000-8000-000000000002',
    ]);
  });

  it('FakeRandom trả theo hàng đợi, hết ⇒ lỗi, ngoài khoảng ⇒ lỗi', () => {
    const random = new FakeRandom({ tokens: ['t1'], ints: [3, 9] });
    expect(random.token(32)).toBe('t1');
    expect(random.tokenRequests).toEqual([32]);
    expect(() => random.token(32)).toThrow('hết token');
    expect(random.int(0, 5)).toBe(3);
    expect(() => random.int(0, 5)).toThrow('ngoài');
    expect(() => random.int(0, 5)).toThrow('hết số nguyên');
  });
});

describe('spies', () => {
  it('SpyLogger ghi level/msg/data, child gộp bindings', () => {
    const logger = new SpyLogger();
    logger.info('a');
    logger.child({ requestId: 'r' }).warn({ x: 1 }, 'b');
    expect(logger.entries).toEqual([
      { level: 'info', msg: 'a', data: {} },
      { level: 'warn', msg: 'b', data: { requestId: 'r', x: 1 } },
    ]);
    expect(logger.messages('warn')).toEqual(['b']);
  });

  it('SpyEventBus ghi event và gọi handler, unsubscribe được', async () => {
    const bus = new SpyEventBus();
    const seen: string[] = [];
    const off = bus.subscribe('A', (e) => void seen.push(e.aggregateId));
    const ev = { type: 'A', aggregateId: 'x', occurredAt: new Date() };
    await bus.publish([ev]);
    off();
    await bus.publish([ev]);
    expect(bus.types()).toEqual(['A', 'A']);
    expect(seen).toEqual(['x']);
  });

  it('createSpy ghi mọi lời gọi và biết có đang trong transaction không', async () => {
    interface Notifier {
      disconnectUser(userId: string): Promise<void>;
    }
    const uow = new FakeUnitOfWork();
    const notifier = createSpy<Notifier>(uow);
    await uow.run(async () => {
      await notifier.disconnectUser('in-tx');
      uow.afterCommit(() => notifier.disconnectUser('after'));
    });
    expect(notifier.calls).toEqual([
      { method: 'disconnectUser', args: ['in-tx'], duringTransaction: true },
      { method: 'disconnectUser', args: ['after'], duringTransaction: false },
    ]);
    expect((notifier as unknown as { then?: unknown }).then).toBeUndefined();
  });
});

describe('testValkeyUrl / integrationRequired (T-022)', () => {
  it('ưu tiên VALKEY_URL_TEST, rồi tên cũ TEST_VALKEY_URL (deprecated), rồi mặc định 6380', () => {
    expect(testValkeyUrl({ VALKEY_URL_TEST: 'redis://a:1', TEST_VALKEY_URL: 'redis://b:2' })).toBe(
      'redis://a:1',
    );
    expect(testValkeyUrl({ TEST_VALKEY_URL: 'redis://b:2' })).toBe('redis://b:2');
    expect(testValkeyUrl({})).toBe('redis://127.0.0.1:6380');
  });

  it('REQUIRE_INTEGRATION chỉ bật khi đúng "1"', () => {
    expect(integrationRequired({ REQUIRE_INTEGRATION: '1' })).toBe(true);
    expect(integrationRequired({ REQUIRE_INTEGRATION: 'true' })).toBe(false);
    expect(integrationRequired({})).toBe(false);
  });
});
