import { EmailAlreadyExistsError } from '../../../../../core/errors';
import type { IUserRepository } from '../../../application/ports/user-repository.port';
import type { Email } from '../../../domain/email';
import { User, type UserSnapshot } from '../../../domain/user';

/**
 * Bản InMemory cùng hợp đồng với bản Prisma (LSP). Lưu snapshot (không giữ tham chiếu aggregate)
 * để `restore()` của FakeUnitOfWork rollback được thật.
 */
export class InMemoryUserRepository implements IUserRepository {
  #rows = new Map<string, UserSnapshot>();

  findById(id: string): Promise<User | null> {
    const row = this.#rows.get(id);
    return Promise.resolve(row ? User.reconstitute(row) : null);
  }

  findByEmail(email: Email): Promise<User | null> {
    const row = [...this.#rows.values()].find((r) => r.email === email.value);
    return Promise.resolve(row ? User.reconstitute(row) : null);
  }

  add(user: User): Promise<void> {
    const snap = user.toSnapshot();
    // Mô phỏng unique constraint (users.email) — không phải SELECT-trước-INSERT ở use case.
    if ([...this.#rows.values()].some((r) => r.email === snap.email)) {
      return Promise.reject(new EmailAlreadyExistsError());
    }
    this.#rows.set(snap.id, snap);
    return Promise.resolve();
  }

  save(user: User): Promise<void> {
    if (!this.#rows.has(user.id)) return Promise.reject(new Error(`User ${user.id} không tồn tại`));
    this.#rows.set(user.id, user.toSnapshot());
    return Promise.resolve();
  }

  getTokenVersion(userId: string): Promise<number | null> {
    const row = this.#rows.get(userId);
    return Promise.resolve(row && row.deletedAt === null ? row.tokenVersion : null);
  }

  /** Cho test đọc trạng thái lưu trữ. */
  rows(): UserSnapshot[] {
    return [...this.#rows.values()].map((r) => ({ ...r }));
  }

  snapshot(): unknown {
    return new Map([...this.#rows].map(([k, v]) => [k, { ...v }]));
  }

  restore(snapshot: unknown): void {
    this.#rows = snapshot as Map<string, UserSnapshot>;
  }
}
