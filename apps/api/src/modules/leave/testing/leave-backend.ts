import { FakeUnitOfWork } from '../../../../test/support/fake-unit-of-work';
import type { IUnitOfWork } from '../../../core/persistence/unit-of-work';
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
  /** Dựng sẵn user/workspace của fixture (FK ở bản Prisma); InMemory: không làm gì. */
  prepare(fixture: { workspaces: readonly string[]; users: readonly string[] }): Promise<void>;
  seed(record: LeaveRequestRecord): Promise<void>;
  rows(): Promise<LeaveRequestRecord[]>;
}

export function inMemoryLeaveBackend(): LeaveBackend {
  const requests = new InMemoryLeaveRepository();
  return {
    uow: new FakeUnitOfWork(requests),
    requests,
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

  lockUser(workspaceId: string, userId: string): Promise<void> {
    this.locks.push(`taskflow:leave:${workspaceId}:${userId}`);
    return this.inner.lockUser(workspaceId, userId);
  }
  listHolding(workspaceId: string, userId: string, year: number): Promise<LeaveRequestRecord[]> {
    return this.inner.listHolding(workspaceId, userId, year);
  }
  find(workspaceId: string, id: string): Promise<LeaveRequestRecord | null> {
    return this.inner.find(workspaceId, id);
  }
  add(record: LeaveRequestRecord): Promise<void> {
    return this.inner.add(record);
  }
  save(record: LeaveRequestRecord, expectedVersion: number): Promise<boolean> {
    return this.inner.save(record, expectedVersion);
  }
  getOrCreateBalance(
    workspaceId: string,
    userId: string,
    year: number,
  ): Promise<LeaveBalanceRecord> {
    return this.inner.getOrCreateBalance(workspaceId, userId, year);
  }
  setBalanceAdjustment(
    workspaceId: string,
    userId: string,
    year: number,
    adjustment: HalfDays,
  ): Promise<void> {
    return this.inner.setBalanceAdjustment(workspaceId, userId, year, adjustment);
  }
  hasHistory(workspaceId: string, userId: string): Promise<boolean> {
    return this.inner.hasHistory(workspaceId, userId);
  }
}
