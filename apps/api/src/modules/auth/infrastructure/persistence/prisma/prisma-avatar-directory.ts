import type {
  AvatarSweepState,
  IAvatarDirectory,
} from '../../../application/ports/avatar-directory.port';
import type { DbProvider } from './db';

/**
 * Bảng `users` là của auth; điều kiện "thuộc công ty" đọc `company_members` / `company_member_departures` (chỉ đọc,
 * như read model của Task join `users`). Một truy vấn cho cả danh sách.
 */
export class PrismaAvatarDirectory implements IAvatarDirectory {
  constructor(private readonly db: DbProvider) {}

  async activeVersions(ids: readonly string[]): Promise<ReadonlyMap<string, number>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await this.db().$queryRaw<{ id: string; avatar_version: number }[]>`
      SELECT u.id, u.avatar_version
        FROM users u
        JOIN company_members cm ON cm.user_id = u.id
       WHERE u.id = ANY(${unique}::uuid[])
         AND u.deleted_at IS NULL
         AND u.avatar_version IS NOT NULL`;
    return new Map(rows.map((r) => [r.id, r.avatar_version]));
  }

  async sweepStates(ids: readonly string[]): Promise<ReadonlyMap<string, AvatarSweepState>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await this.db().$queryRaw<
      { id: string; avatar_version: number | null; member: boolean; left_at: Date | null }[]
    >`
      SELECT u.id, u.avatar_version,
             (cm.user_id IS NOT NULL AND u.deleted_at IS NULL) AS member,
             (SELECT max(d.left_at) FROM company_member_departures d WHERE d.user_id = u.id) AS left_at
        FROM users u
        LEFT JOIN company_members cm ON cm.user_id = u.id
       WHERE u.id = ANY(${unique}::uuid[])`;
    return new Map(
      rows.map((r) => [r.id, { version: r.avatar_version, member: r.member, leftAt: r.left_at }]),
    );
  }

  async clearDeparted(ids: readonly string[]): Promise<number> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return 0;
    return this.db().$executeRaw`
      UPDATE users u SET avatar_version = NULL, updated_at = now()
       WHERE u.id = ANY(${unique}::uuid[])
         AND u.avatar_version IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM company_members cm WHERE cm.user_id = u.id)`;
  }
}
