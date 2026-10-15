// Contract test dùng chung (đề xuất của QA F, T-017 §B.4 — T-020): CÙNG một bộ khẳng định chạy cho
// bản InMemory (unit) và bản Prisma/Valkey (integration). Mỗi hành vi bên dưới là hợp đồng của port.
import { randomUUID } from 'node:crypto';
import type { IRefreshTokenRepository } from '../../application/ports/refresh-token-repository.port';
import type { IUserRepository } from '../../application/ports/user-repository.port';
import { Email } from '../../domain/email';
import { RefreshToken } from '../../domain/refresh-token';
import { User } from '../../domain/user';

export const T0 = new Date('2026-11-01T00:00:00.000Z');
export const T1 = new Date('2026-11-02T00:00:00.000Z');
export const DAY = 86_400_000;

export interface AuthPersistence {
  users: IUserRepository;
  refreshTokens: IRefreshTokenRepository;
  /** Đánh dấu user đã xóa (D2) — repo không có lệnh này nên fixture tự làm. */
  markDeleted(userId: string): Promise<void>;
}

export const newUser = (email = `${randomUUID()}@example.com`) =>
  User.register({
    id: randomUUID(),
    email: Email.create(email),
    passwordHash: 'h:old',
    fullName: 'Alice',
    now: T0,
  });

export const newToken = (
  userId: string,
  familyId: string = randomUUID(),
  hash: string = randomUUID().replace(/-/g, '').padEnd(64, '0'),
) =>
  RefreshToken.issue({
    id: randomUUID(),
    userId,
    tokenHash: hash,
    familyId,
    familyExpiresAt: new Date(T0.getTime() + 30 * DAY),
    now: T0,
    meta: { userAgent: null, ip: null },
  });
