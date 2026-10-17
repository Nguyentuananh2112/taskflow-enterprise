import { Prisma } from '../../../../../generated/prisma/client';
import { accessSql, activeSql, type DbProvider } from './chat-db';

/** Quyền / người nhận / sweep của chat trên Postgres (T-069a) — phần của PrismaChatConversationStore. */
export class PrismaChatAccess {
  constructor(private readonly db: DbProvider) {}

  async canAccess(conversationId: string, userId: string, now: Date): Promise<boolean> {
    const rows = await this.db().$queryRaw<unknown[]>`
      SELECT 1 FROM (${accessSql(now, Prisma.sql`c.id = ${conversationId}::uuid`)}) a
       WHERE a.user_id = ${userId}::uuid LIMIT 1`;
    return rows.length > 0;
  }

  async isWorkspaceMember(workspaceId: string, userId: string, now: Date): Promise<boolean> {
    const rows = await this.db().$queryRaw<unknown[]>`
      SELECT 1 FROM workspace_members wm
        JOIN workspaces w ON w.id = wm.workspace_id AND w.deleted_at IS NULL AND w.archived_at IS NULL
        JOIN company_members cm ON cm.user_id = wm.user_id
        JOIN users u ON u.id = wm.user_id
       WHERE wm.workspace_id = ${workspaceId}::uuid AND wm.user_id = ${userId}::uuid AND ${activeSql(now)}`;
    return rows.length > 0;
  }

  async recipientIds(conversationId: string, now: Date): Promise<string[]> {
    const rows = await this.db().$queryRaw<{ user_id: string }[]>`
      SELECT DISTINCT a.user_id FROM (${accessSql(now, Prisma.sql`c.id = ${conversationId}::uuid`)}) a`;
    return rows.map((r) => r.user_id);
  }

  async activeUserIds(userIds: readonly string[], now: Date): Promise<Set<string>> {
    if (userIds.length === 0) return new Set();
    const rows = await this.db().$queryRaw<{ id: string }[]>`
      SELECT u.id FROM users u JOIN company_members cm ON cm.user_id = u.id
       WHERE u.id = ANY(${userIds as string[]}::uuid[]) AND ${activeSql(now)}`;
    return new Set(rows.map((r) => r.id));
  }

  /** Sweep (DIRECT/GROUP): participant còn left_at NULL của người không còn dòng company_members. */
  markLeftForNonMembers(now: Date, limit: number): Promise<number> {
    return this.db().$executeRaw`
      UPDATE chat_participants p SET left_at = ${now}
       WHERE (p.conversation_id, p.user_id) IN (
         SELECT p2.conversation_id, p2.user_id FROM chat_participants p2
          WHERE p2.left_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM company_members cm WHERE cm.user_id = p2.user_id)
          ORDER BY p2.conversation_id, p2.user_id
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED)`;
  }
}
