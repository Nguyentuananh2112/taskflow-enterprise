import { describe, expect, it } from 'vitest';

import { SpyLogger } from '../../../test/support';
import { PrismaUnitOfWork, type TransactionCapable } from './prisma-unit-of-work';
import { AfterCommitOutsideTransactionError } from './unit-of-work';

interface Db {
  label: string;
}

/** Giả lập `$transaction` của Prisma: cấp client giao dịch riêng, ghi commit/rollback. */
class FakePrisma implements TransactionCapable<Db>, Db {
  readonly label = 'root';
  readonly log: string[] = [];
  readonly options: unknown[] = [];
  #seq = 0;

  async $transaction<R>(fn: (tx: Db) => Promise<R>, options?: unknown): Promise<R> {
    this.options.push(options);
    const tx: Db = { label: `tx${++this.#seq}` };
    this.log.push(`begin:${tx.label}`);
    try {
      const result = await fn(tx);
      this.log.push(`commit:${tx.label}`);
      return result;
    } catch (err) {
      this.log.push(`rollback:${tx.label}`);
      throw err;
    }
  }
}

const setup = (options = {}) => {
  const prisma = new FakePrisma();
  const logger = new SpyLogger();
  const uow = new PrismaUnitOfWork<Db>(prisma, logger, options);
  return { prisma, logger, uow };
};

describe('PrismaUnitOfWork', () => {
  it('ngoài run(): db() là client gốc, inTransaction=false', () => {
    const { uow } = setup();
    expect(uow.db().label).toBe('root');
    expect(uow.inTransaction).toBe(false);
  });

  it('trong run(): db() là client giao dịch, kể cả sau await (AsyncLocalStorage)', async () => {
    const { uow } = setup();
    const seen = await uow.run(async () => {
      const before = uow.db().label;
      await new Promise((r) => setTimeout(r, 1));
      return [before, uow.db().label, uow.inTransaction];
    });
    expect(seen).toEqual(['tx1', 'tx1', true]);
    expect(uow.db().label).toBe('root');
  });

  it('run() lồng nhau dùng lại transaction ngoài (một begin/commit)', async () => {
    const { uow, prisma } = setup();
    const inner = await uow.run(() => uow.run(() => Promise.resolve(uow.db().label)));
    expect(inner).toBe('tx1');
    expect(prisma.log).toEqual(['begin:tx1', 'commit:tx1']);
  });

  it('hook afterCommit chạy SAU commit, đúng thứ tự, khi đã ra khỏi transaction', async () => {
    const { uow, prisma } = setup();
    const order: string[] = [];
    await uow.run(() => {
      uow.afterCommit(
        () => void order.push(`h1 inTx=${uow.inTransaction} ${prisma.log.join(',')}`),
      );
      uow.afterCommit(() => Promise.resolve(void order.push('h2')));
      order.push('work');
      return Promise.resolve();
    });
    expect(order).toEqual(['work', 'h1 inTx=false begin:tx1,commit:tx1', 'h2']);
  });

  it('work ném lỗi ⇒ rollback, hook KHÔNG chạy, lỗi được ném lại nguyên vẹn', async () => {
    const { uow, prisma } = setup();
    const boom = new Error('boom');
    let hookRan = false;
    await expect(
      uow.run(() => {
        uow.afterCommit(() => void (hookRan = true));
        return Promise.reject(boom);
      }),
    ).rejects.toBe(boom);
    expect(prisma.log).toEqual(['begin:tx1', 'rollback:tx1']);
    expect(hookRan).toBe(false);
  });

  it('hook lỗi được log, không đổi kết quả run, hook sau vẫn chạy', async () => {
    const { uow, logger } = setup();
    const order: string[] = [];
    const result = await uow.run(() => {
      uow.afterCommit(function broadcast() {
        throw new Error('socket down');
      });
      uow.afterCommit(() => void order.push('next'));
      return Promise.resolve(42);
    });
    expect(result).toBe(42);
    expect(order).toEqual(['next']);
    expect(logger.entries).toMatchObject([
      { level: 'error', msg: 'uow.after_commit_failed', data: { hook: 'broadcast' } },
    ]);
  });

  it('afterCommit ngoài run() ⇒ ném lỗi lập trình', () => {
    const { uow } = setup();
    expect(() => uow.afterCommit(() => undefined)).toThrow(AfterCommitOutsideTransactionError);
  });

  it('hai run() song song có transaction riêng, không lẫn ngữ cảnh', async () => {
    const { uow } = setup();
    const tick = () => new Promise((r) => setTimeout(r, 1));
    const [a, b] = await Promise.all([
      uow.run(async () => {
        await tick();
        return uow.db().label;
      }),
      uow.run(async () => {
        await tick();
        return uow.db().label;
      }),
    ]);
    expect(new Set([a, b])).toEqual(new Set(['tx1', 'tx2']));
  });

  it('truyền timeout/maxWait mặc định và isolationLevel của từng lần gọi', async () => {
    const { uow, prisma } = setup({ timeout: 10_000, maxWait: 2_000 });
    await uow.run(() => Promise.resolve(), { isolationLevel: 'Serializable' });
    expect(prisma.options).toEqual([
      { timeout: 10_000, maxWait: 2_000, isolationLevel: 'Serializable' },
    ]);
  });
});
