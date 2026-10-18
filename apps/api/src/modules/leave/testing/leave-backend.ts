import { FakeUnitOfWork } from '../../../../test/support/fake-unit-of-work';
import type { IUnitOfWork } from '../../../core/persistence/unit-of-work';
import type { ILeaveReadModel } from '../application/ports/leave-read-model.port';
import type {
  ILeavePolicyStore,
  ILeaveRepository,
  LeaveBalanceRecord,
  LeavePolicyRow,
  LeaveRequestRecord,
} from '../application/ports/leave.ports';
import type { HalfDays } from '../domain/leave-days';
import type { LeavePolicy } from '../domain/leave-policy';
import { InMemoryLeavePolicyStore } from '../infrastructure/persistence/in-memory/in-memory-leave-policy.store';
import { InMemoryLeaveRepository } from '../infrastructure/persistence/in-memory/in-memory-leave.repository';

/**
 * Phần lưu trữ của harness leave — bản InMemory (test A) hoặc Prisma/Postgres (tầng I — LSP, chạy lại NGUYÊN
 * file test A). Phần "dữ liệu" (seed/đọc thẳng) async để bản Prisma dùng được. Lịch / membership / thông báo /
 * audit vẫn là fake ở cả hai bản (adapter thật thuộc T-037/T-038/T-040).
 */
export interface LeaveBackend {
  readonly uow: IUnitOfWork & { readonly commits: number; readonly rollbacks: number };
  readonly requests: ILeaveRepository;
  readonly readModel: ILeaveReadModel;
  /** Chính sách phép (T-057). */
  readonly policies: ILeavePolicyStore;
  /** Dựng sẵn user của fixture (FK ở bản Prisma); InMemory: không làm gì. */
  prepare(fixture: { users: readonly string[] }): Promise<void>;
  seed(record: LeaveRequestRecord): Promise<void>;
  rows(): Promise<LeaveRequestRecord[]>;
}

export function inMemoryLeaveBackend(): LeaveBackend {
  const requests = new InMemoryLeaveRepository();
  const policies = new InMemoryLeavePolicyStore();
  return {
    uow: new FakeUnitOfWork(requests, policies),
    requests,
    readModel: requests,
    policies,
    prepare: () => Promise.resolve(),
    seed: (record) => {
      requests.seed(record);
      return Promise.resolve();
    },
    rows: () => Promise.resolve(requests.rows()),
  };
}

/**
 * Bọc repo để ghi thứ tự khóa (test "khóa TRƯỚC khi đọc", "khóa của người sở hữu đơn") cho cả hai backend.
 * Test có thể thay `lockUser` của chính đối tượng này (LV-25: thu grant đúng lúc đang chờ khóa).
 */
export class RecordingLeaveRepository implements ILeaveRepository {
  readonly locks: string[] = [];

  constructor(private readonly inner: ILeaveRepository) {}

  lockUser(userId: string): Promise<void> {
    this.locks.push(`taskflow:leave:${userId}`);
    return this.inner.lockUser(userId);
  }
  listHolding(userId: string, year: number): Promise<LeaveRequestRecord[]> {
    return this.inner.listHolding(userId, year);
  }
  clearPendingReasons(userId: string): Promise<number> {
    return this.inner.clearPendingReasons(userId);
  }
  listOpen(userId: string): Promise<LeaveRequestRecord[]> {
    return this.inner.listOpen(userId);
  }
  find(id: string): Promise<LeaveRequestRecord | null> {
    return this.inner.find(id);
  }
  add(record: LeaveRequestRecord): Promise<void> {
    return this.inner.add(record);
  }
  save(record: LeaveRequestRecord, expectedVersion: number): Promise<boolean> {
    return this.inner.save(record, expectedVersion);
  }
  getOrCreateBalance(userId: string, year: number): Promise<LeaveBalanceRecord> {
    return this.inner.getOrCreateBalance(userId, year);
  }
  setBalanceAdjustment(userId: string, year: number, adjustment: HalfDays): Promise<void> {
    return this.inner.setBalanceAdjustment(userId, year, adjustment);
  }
  setCarried(
    userId: string,
    year: number,
    carried: HalfDays,
    mode: 'ifNull' | 'overwrite',
  ): Promise<void> {
    return this.inner.setCarried(userId, year, carried, mode);
  }
}

/** Bọc store chính sách: khóa ghi vào CÙNG danh sách với khóa user ⇒ test kiểm thứ tự policy → leave:<user>. */
export class RecordingLeavePolicyStore implements ILeavePolicyStore {
  constructor(
    private readonly inner: ILeavePolicyStore,
    private readonly locks: string[],
  ) {}

  lock(mode: 'shared' | 'exclusive'): Promise<void> {
    this.locks.push(`taskflow:leave-policy:${mode}`);
    return this.inner.lock(mode);
  }
  list(): Promise<LeavePolicyRow[]> {
    return this.inner.list();
  }
  put(input: {
    year: number;
    policy: LeavePolicy;
    expectedVersion: number;
    updatedById: string;
    at: Date;
  }): Promise<LeavePolicyRow | null> {
    return this.inner.put(input);
  }
}
