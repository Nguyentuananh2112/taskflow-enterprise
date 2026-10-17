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

  findManyByIds(ids: readonly string[]): Promise<User[]> {
    const wanted = new Set(ids);
    return Promise.resolve(
      [...this.#rows.values()].filter((r) => wanted.has(r.id)).map((r) => User.reconstitute(r)),
    );
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

  /** InMemory: transaction tuần tự hóa sẵn — không cần khóa. */
  lockTokenVersion(userId: string): Promise<number | null> {
    return this.getTokenVersion(userId);
  }
  getTokenVersion(userId: string): Promise<number | null> {
    return Promise.resolve(this.#live(userId)?.tokenVersion ?? null);
  }

  // Các lệnh intent (ADR-104): mỗi lệnh đọc-kiểm-ghi đồng bộ trên một dòng ⇒ nguyên tử như 1 câu UPDATE.

  recordLogin(input: { id: string; expectedHash: string; at: Date }): Promise<number | null> {
    const { id, at } = input;
    const row = this.#live(id);
    if (!row || row.passwordHash !== input.expectedHash) return Promise.resolve(null);
    this.#rows.set(id, { ...row, lastLoginAt: at, updatedAt: at });
    return Promise.resolve(row.tokenVersion);
  }

  rehashPassword(input: {
    id: string;
    oldHash: string;
    newHash: string;
    at: Date;
  }): Promise<boolean> {
    const row = this.#live(input.id);
    if (!row || row.passwordHash !== input.oldHash) return Promise.resolve(false);
    this.#rows.set(input.id, { ...row, passwordHash: input.newHash, updatedAt: input.at });
    return Promise.resolve(true);
  }

  changePassword(input: {
    id: string;
    oldHash: string;
    newHash: string;
    at: Date;
  }): Promise<number | null> {
    const row = this.#live(input.id);
    if (!row || row.passwordHash !== input.oldHash) return Promise.resolve(null);
    const tokenVersion = row.tokenVersion + 1;
    this.#rows.set(input.id, {
      ...row,
      passwordHash: input.newHash,
      passwordChangedAt: input.at,
      tokenVersion,
      updatedAt: input.at,
    });
    return Promise.resolve(tokenVersion);
  }

  setInitialPassword(input: { id: string; hash: string; at: Date }): Promise<number | null> {
    const row = this.#live(input.id);
    if (!row || row.passwordHash !== null) return Promise.resolve(null);
    this.#rows.set(input.id, {
      ...row,
      passwordHash: input.hash,
      passwordChangedAt: input.at,
      updatedAt: input.at,
    });
    return Promise.resolve(row.tokenVersion);
  }

  bumpTokenVersion(id: string, at: Date): Promise<number | null> {
    const row = this.#live(id);
    if (!row) return Promise.resolve(null);
    const tokenVersion = row.tokenVersion + 1;
    this.#rows.set(id, { ...row, tokenVersion, updatedAt: at });
    return Promise.resolve(tokenVersion);
  }

  updateProfile(input: { id: string; fullName: string; at: Date }): Promise<boolean> {
    const row = this.#live(input.id);
    if (!row) return Promise.resolve(false);
    this.#rows.set(input.id, { ...row, fullName: input.fullName, updatedAt: input.at });
    return Promise.resolve(true);
  }

  /** Dòng của user chưa xóa (mọi lệnh intent đều có điều kiện `deleted_at IS NULL`). */
  #live(id: string): UserSnapshot | undefined {
    const row = this.#rows.get(id);
    return row && row.deletedAt === null ? row : undefined;
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
