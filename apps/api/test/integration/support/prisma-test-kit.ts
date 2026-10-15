import { createClient } from 'redis';

import type {
  AfterCommitHook,
  IUnitOfWork,
  UnitOfWorkOptions,
} from '../../../src/core/persistence/unit-of-work';
import {
  PrismaUnitOfWork,
  type TransactionCapable,
} from '../../../src/core/persistence/prisma-unit-of-work';
import type { Prisma, PrismaClient } from '../../../src/generated/prisma/client';
import { SpyLogger, type UowStep } from '../../support';
import { createTestPrisma, truncateAll } from '../db';

/** Prisma dùng chung cho cả file test (pool riêng ⇒ transaction song song chạy trên connection thật). */
let shared: PrismaClient | undefined;
export function testPrisma(): PrismaClient {
  shared ??= createTestPrisma();
  return shared;
}

export async function resetDatabase(): Promise<void> {
  await truncateAll(testPrisma());
}

export async function disconnectTestPrisma(): Promise<void> {
  await shared?.$disconnect();
  shared = undefined;
}

/**
 * Bọc `PrismaUnitOfWork` thật (T-009), ghi lại begin/commit/rollback như `FakeUnitOfWork` để chạy
 * lại đúng bộ test use case với repo Prisma (LSP). `commit` được ghi SAU khi hook afterCommit chạy
 * (bản thật chạy hook trong `run`), không ảnh hưởng các khẳng định hiện có.
 */
export class RecordingUnitOfWork implements IUnitOfWork {
  readonly steps: UowStep[] = [];
  readonly hookErrors: unknown[] = [];
  readonly inner: PrismaUnitOfWork<Prisma.TransactionClient>;

  constructor(prisma: PrismaClient = testPrisma()) {
    // `PrismaClient.$transaction` là hàm overload (mảng | callback) nên không gán thẳng được vào
    // `TransactionCapable` (chỉ khai overload callback). Runtime đúng — overload callback có thật.
    // Báo A: composition root (main.ts) sẽ gặp đúng chỗ này (T-020 report).
    const client = prisma as unknown as TransactionCapable<Prisma.TransactionClient> &
      Prisma.TransactionClient;
    // maxWait rộng: test race mở ~20 transaction song song > pool mặc định (10) trên máy dev bận.
    this.inner = new PrismaUnitOfWork<Prisma.TransactionClient>(client, new SpyLogger(), {
      timeout: 20_000,
      maxWait: 60_000,
    });
  }

  get inTransaction(): boolean {
    return this.inner.inTransaction;
  }
  get commits(): number {
    return this.steps.filter((s) => s === 'commit').length;
  }
  get rollbacks(): number {
    return this.steps.filter((s) => s === 'rollback').length;
  }

  db(): Prisma.TransactionClient {
    return this.inner.db();
  }

  async run<T>(work: () => Promise<T>, options?: UnitOfWorkOptions): Promise<T> {
    if (this.inner.inTransaction) return work();
    this.steps.push('begin');
    try {
      const result = await this.inner.run(work, options);
      this.steps.push('commit');
      return result;
    } catch (err) {
      this.steps.push('rollback');
      throw err;
    }
  }

  afterCommit(hook: AfterCommitHook): void {
    this.inner.afterCommit(hook);
  }

  /** Tương thích `FakeUnitOfWork.enlist` — repo Prisma không cần snapshot. */
  enlist(): this {
    return this;
  }
}

/** Valkey thật cho integration (container tạm hoặc compose của D). */
export function testValkeyUrl(): string {
  const url = process.env.VALKEY_URL_TEST;
  if (!url) throw new Error('Thiếu VALKEY_URL_TEST (integration cần Valkey thật)');
  return url;
}

export async function connectTestValkey() {
  const client = createClient({ url: testValkeyUrl() });
  client.on('error', () => undefined); // test tự kiểm lỗi qua lệnh; tránh crash khi đóng
  await client.connect();
  return client;
}
