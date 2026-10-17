import type {
  IMemberCandidateDirectory,
  MemberCandidate,
} from '../../../application/ports/collaborators.port';
import type { DbProvider } from './db';
import { escapeLike } from './prisma-queries';

/**
 * `member-candidates` (ADR-134): đọc thẳng `company_members` JOIN `users` (CQRS-lite, như phía đọc của leave) —
 * người thuộc công ty chưa có lịch nghỉ, tài khoản chưa xóa, chưa ở ws. ILIKE có ESCAPE tường minh, tham số hóa
 * hoàn toàn qua `$queryRaw` (security.md 6.7).
 */
export class PrismaMemberCandidates implements IMemberCandidateDirectory {
  constructor(private readonly db: DbProvider) {}

  search(input: { workspaceId: string; q: string; limit: number }): Promise<MemberCandidate[]> {
    const pattern = `%${escapeLike(input.q)}%`;
    return this.db().$queryRaw<MemberCandidate[]>`
      SELECT u.id, u.full_name AS "fullName", u.email
        FROM company_members cm
        JOIN users u ON u.id = cm.user_id
       WHERE cm.offboard_last_day IS NULL
         AND u.deleted_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM workspace_members wm
            WHERE wm.workspace_id = ${input.workspaceId}::uuid AND wm.user_id = u.id)
         AND (u.full_name ILIKE ${pattern} ESCAPE '\' OR u.email ILIKE ${pattern} ESCAPE '\')
       ORDER BY u.full_name, u.id
       LIMIT ${input.limit}`;
  }
}
