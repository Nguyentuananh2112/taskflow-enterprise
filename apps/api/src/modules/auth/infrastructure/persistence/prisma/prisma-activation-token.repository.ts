import type {
  ActivationTokenRecord,
  IActivationTokenRepository,
} from '../../../application/ports/activation-token-repository.port';
import type { DbProvider } from './db';

/** ADR-137: mọi thay đổi trạng thái là UPDATE có điều kiện — READ COMMITTED đánh giá lại WHERE sau khóa dòng. */
export class PrismaActivationTokenRepository implements IActivationTokenRepository {
  constructor(private readonly db: DbProvider) {}

  async issue(input: Parameters<IActivationTokenRepository['issue']>[0]): Promise<void> {
    // Thu hồi TRƯỚC khi thêm: unique một phần `…_live_key` (user_id WHERE sống) chặn hai token sống.
    await this.revokeAllForUser(input.userId, input.at);
    await this.db().accountActivationToken.create({
      data: {
        id: input.id,
        userId: input.userId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        createdById: input.createdById,
        createdAt: input.at,
      },
      select: { id: true },
    });
  }

  findByHash(tokenHash: string): Promise<ActivationTokenRecord | null> {
    return this.db().accountActivationToken.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, expiresAt: true, usedAt: true, revokedAt: true },
    });
  }

  async consume(id: string, at: Date): Promise<boolean> {
    const { count } = await this.db().accountActivationToken.updateMany({
      where: { id, usedAt: null, revokedAt: null, expiresAt: { gt: at } },
      data: { usedAt: at },
    });
    return count === 1;
  }

  async revokeAllForUser(userId: string, at: Date): Promise<number> {
    const { count } = await this.db().accountActivationToken.updateMany({
      where: { userId, usedAt: null, revokedAt: null },
      data: { revokedAt: at },
    });
    return count;
  }
}
