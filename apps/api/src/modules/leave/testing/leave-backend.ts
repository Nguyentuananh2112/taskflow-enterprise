import { FakeUnitOfWork } from '../../../../test/support/fake-unit-of-work';
import type { IUnitOfWork } from '../../../core/persistence/unit-of-work';
import type { ILeaveReadModel } from '../application/ports/leave-read-model.port';
import type {
  ILeaveRepository,
  LeaveBalanceRecord,
  LeaveRequestRecord,
} from '../application/ports/leave.ports';
import type { HalfDays } from '../domain/leave-days';
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
  /** Dựng sẵn user của fixture (FK ở bản Prisma); InMemory: không làm gì. */
  prepare(fixture: { users: readonly string[] }): Promise<void>;
  seed(record: LeaveRequestRecord): Promise<void>;
  rows(): Promise<LeaveRequestRecord[]>;
}

export function inMemoryLeaveBackend(): LeaveBackend {
  const requests = new InMemoryLeaveRepository();
  return {
    uow: new FakeUnitOfWork(requests),
    requests,
    readModel: requests,
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
}
