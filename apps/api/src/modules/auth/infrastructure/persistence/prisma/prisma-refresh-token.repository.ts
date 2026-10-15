import type { IRefreshTokenRepository } from '../../../application/ports/refresh-token-repository.port';
import { RefreshToken, type RefreshTokenRevokeReason } from '../../../domain/refresh-token';
import type { DbProvider } from './db';

const TOKEN_COLUMNS = {
  id: true,
  userId: true,
  tokenHash: true,
  familyId: true,
  replacedById: true,
  expiresAt: true,
  familyExpiresAt: true,
  revokedAt: true,
  revokedReason: true,
  userAgent: true,
  ip: true,
  createdAt: true,
} as const;

/**
 * ADR-024. Xoay/thu hồi đều là UPDATE có điều kiện `revoked_at IS NULL`: ở READ COMMITTED, request
 * thứ hai chờ khóa dòng rồi đánh giá lại điều kiện ⇒ chỉ một bên thắng (REF-06).
 */
export class PrismaRefreshTokenRepository implements IRefreshTokenRepository {
  constructor(private readonly db: DbProvider) {}

  async add(token: RefreshToken): Promise<void> {
    await this.db().refreshToken.create({ data: token.toSnapshot(), select: { id: true } });
  }

  async findByHash(tokenHash: string): Promise<RefreshToken | null> {
    const row = await this.db().refreshToken.findUnique({
      where: { tokenHash },
      select: TOKEN_COLUMNS,
    });
    return row ? RefreshToken.reconstitute(row) : null;
  }

  async markRotated(id: string, successorId: string, at: Date): Promise<boolean> {
    const { count } = await this.db().refreshToken.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: at, revokedReason: 'ROTATED', replacedById: successorId },
    });
    return count === 1;
  }

  async revokeFamily(
    familyId: string,
    reason: RefreshTokenRevokeReason,
    at: Date,
  ): Promise<number> {
    const { count } = await this.db().refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: at, revokedReason: reason },
    });
    return count;
  }

  async revokeAllForUser(
    userId: string,
    reason: RefreshTokenRevokeReason,
    at: Date,
  ): Promise<number> {
    const { count } = await this.db().refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: at, revokedReason: reason },
    });
    return count;
  }

  async isSessionRevoked(familyId: string): Promise<boolean> {
    const row = await this.db().refreshToken.findFirst({
      where: { familyId, revokedReason: { in: ['LOGOUT', 'REUSE_DETECTED'] } },
      select: { id: true },
    });
    return row !== null;
  }
  async listRevokedSessionsSince(
    userId: string,
    since: Date,
  ): Promise<{ familyId: string; revokedAt: Date }[]> {
    const rows = await this.db().refreshToken.findMany({
      where: {
        userId,
        revokedReason: { in: ['LOGOUT', 'REUSE_DETECTED'] },
        revokedAt: { gte: since },
      },
      select: { familyId: true, revokedAt: true },
    });
    return latestPerFamily(rows);
  }
}

/** Một dòng mỗi family — `revokedAt` mới nhất. */
function latestPerFamily(rows: { familyId: string; revokedAt: Date | null }[]) {
  const latest = new Map<string, Date>();
  for (const { familyId, revokedAt } of rows) {
    if (revokedAt && (latest.get(familyId)?.getTime() ?? -Infinity) < revokedAt.getTime()) {
      latest.set(familyId, revokedAt);
    }
  }
  return [...latest].map(([familyId, revokedAt]) => ({ familyId, revokedAt }));
}
