import { describe, expect, it } from 'vitest';

import { SpyLogger } from '../../test/support';
import { AfterCommitOutsideTransactionError } from '../core/persistence/unit-of-work';
import { InMemoryUnitOfWork, type Snapshottable } from './in-memory-unit-of-work';

class Rows implements Snapshottable {
  rows: string[] = [];
  snapshot(): unknown {
    return [...this.rows];
  }
  restore(snapshot: unknown): void {
    this.rows = snapshot as string[];
  }
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

const setup = () => {
  const rows = new Rows();
  const uow = new InMemoryUnitOfWork([rows], new SpyLogger());
  return { rows, uow };
};

describe('InMemoryUnitOfWork', () => {
  it('QA F (T-021): run() đồng thời KHÔNG chạy lọt vào transaction của request khác — xếp hàng', async () => {
    const { rows, uow } = setup();
    const gate = deferred();
    const order: string[] = [];

    const a = uow.run(async () => {
      order.push('A:start');
      rows.rows.push('a');
      await gate.promise;
      order.push('A:end');
    });
    // Đợi A thật sự vào transaction rồi mới bắt đầu B (đúng kịch bản lỗi).
    await new Promise((r) => setTimeout(r, 5));
    const b = uow.run(() => {
      order.push(`B:start inTx=${uow.inTransaction}`);
      rows.rows.push('b');
      return Promise.resolve();
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(order).toEqual(['A:start']); // B chưa được chạy khi A còn mở
    expect(uow.inTransaction).toBe(false); // ngoài chuỗi async của A

    gate.resolve();
    await Promise.all([a, b]);
    expect(order).toEqual(['A:start', 'A:end', 'B:start inTx=true']);
    expect(rows.rows).toEqual(['a', 'b']);
  });

  it('rollback của request đầu KHÔNG xóa dữ liệu request sau đã commit', async () => {
    const { rows, uow } = setup();
    const gate = deferred();
    const a = uow.run(async () => {
      rows.rows.push('a');
      await gate.promise;
      throw new Error('A fails');
    });
    const b = uow.run(() => {
      rows.rows.push('b');
      return Promise.resolve();
    });
    gate.resolve();
    await expect(a).rejects.toThrow('A fails');
    await b;
    expect(rows.rows).toEqual(['b']);
  });

  it('afterCommit đúng transaction của chuỗi async; ngoài run ⇒ lỗi; hook chạy sau commit', async () => {
    const { uow } = setup();
    const gate = deferred();
    const seen: string[] = [];
    const a = uow.run(async () => {
      uow.afterCommit(() => void seen.push('hook-a'));
      await gate.promise;
    });
    await new Promise((r) => setTimeout(r, 5));
    // Một request khác (ngoài chuỗi async của A) gọi afterCommit ⇒ lỗi lập trình, không dính hook của A.
    expect(() => uow.afterCommit(() => void seen.push('stray'))).toThrow(
      AfterCommitOutsideTransactionError,
    );
    gate.resolve();
    await a;
    expect(seen).toEqual(['hook-a']);
  });

  it('run() lồng nhau trong cùng chuỗi async dùng lại transaction (không deadlock)', async () => {
    const { rows, uow } = setup();
    await uow.run(() =>
      uow.run(() => {
        rows.rows.push('nested');
        return Promise.resolve();
      }),
    );
    expect(rows.rows).toEqual(['nested']);
  });
});
