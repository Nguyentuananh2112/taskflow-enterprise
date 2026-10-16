import { EmailAlreadyExistsError } from '../../../../../core/errors';
import type { IUserRepository } from '../../../application/ports/user-repository.port';
import type { Email } from '../../../domain/email';
import { User } from '../../../domain/user';
import { uniqueConstraintOf, type DbProvider } from './db';

const USER_COLUMNS = {
  id: true,
  email: true,
  passwordHash: true,
  fullName: true,
  tokenVersion: true,
  passwordChangedAt: true,
  lastLoginAt: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export class PrismaUserRepository implements IUserRepository {
  constructor(private readonly db: DbProvider) {}

  async findById(id: string): Promise<User | null> {
    const row = await this.db().user.findUnique({ where: { id }, select: USER_COLUMNS });
    return row ? User.reconstitute(row) : null;
  }

  async findByEmail(email: Email): Promise<User | null> {
    const row = await this.db().user.findUnique({
      where: { email: email.value },
      select: USER_COLUMNS,
    });
    return row ? User.reconstitute(row) : null;
  }

  /** Email trùng ⇒ lỗi từ unique constraint `users_email_key` (không SELECT trước — REG-03). */
  async add(user: User): Promise<void> {
    try {
      await this.db().user.create({ data: user.toSnapshot(), select: { id: true } });
    } catch (err) {
      if (uniqueConstraintOf(err) === 'users_email_key') throw new EmailAlreadyExistsError();
      throw err;
    }
  }

  // ---- Lệnh intent (ADR-104): mỗi lệnh là MỘT câu UPDATE có điều kiện, không đọc-rồi-ghi. ----

  // READ COMMITTED: UPDATE chờ khóa dòng của change-password rồi đánh giá lại WHERE trên bản đã commit
  // ⇒ hash đã đổi thì 0 dòng (null). Login đi trước ⇒ change-password chờ ta commit, revokeAll thấy phiên mới.
  async recordLogin(input: { id: string; expectedHash: string; at: Date }): Promise<number | null> {
    const { id, expectedHash, at } = input;
    const rows = await this.db().$queryRaw<{ token_version: number }[]>`
      UPDATE users SET last_login_at = ${at}, updated_at = ${at}
       WHERE id = ${id}::uuid AND deleted_at IS NULL AND password_hash = ${expectedHash}
      RETURNING token_version`;
    return rows[0]?.token_version ?? null;
  }

  async rehashPassword(input: {
    id: string;
    oldHash: string;
    newHash: string;
    at: Date;
  }): Promise<boolean> {
    const { count } = await this.db().user.updateMany({
      where: { id: input.id, passwordHash: input.oldHash, deletedAt: null },
      data: { passwordHash: input.newHash, updatedAt: input.at },
    });
    return count === 1;
  }

  /** Đổi hash + tăng token_version trong CÙNG câu lệnh — login xen giữa không thể ghi đè (A4). */
  async changePassword(input: {
    id: string;
    oldHash: string;
    newHash: string;
    at: Date;
  }): Promise<number | null> {
    const rows = await this.db().$queryRaw<{ token_version: number }[]>`
      UPDATE users
         SET password_hash = ${input.newHash}, password_changed_at = ${input.at},
             token_version = token_version + 1, updated_at = ${input.at}
       WHERE id = ${input.id}::uuid AND password_hash = ${input.oldHash} AND deleted_at IS NULL
      RETURNING token_version`;
    return rows[0]?.token_version ?? null;
  }

  async bumpTokenVersion(id: string, at: Date): Promise<number | null> {
    const rows = await this.db().$queryRaw<{ token_version: number }[]>`
      UPDATE users SET token_version = token_version + 1, updated_at = ${at}
       WHERE id = ${id}::uuid AND deleted_at IS NULL
      RETURNING token_version`;
    return rows[0]?.token_version ?? null;
  }

  async updateProfile(input: { id: string; fullName: string; at: Date }): Promise<boolean> {
    const { count } = await this.db().user.updateMany({
      where: { id: input.id, deletedAt: null },
      data: { fullName: input.fullName, updatedAt: input.at },
    });
    return count === 1;
  }

  async getTokenVersion(userId: string): Promise<number | null> {
    const row = await this.db().user.findUnique({
      where: { id: userId },
      select: { tokenVersion: true, deletedAt: true },
    });
    return row && row.deletedAt === null ? row.tokenVersion : null;
  }
  async lockTokenVersion(userId: string): Promise<number | null> {
    const rows = await this.db().$queryRaw<{ token_version: number }[]>`
      SELECT token_version FROM users
      WHERE id = ${userId}::uuid AND deleted_at IS NULL
      FOR SHARE`;
    return rows[0]?.token_version ?? null;
  }
}
