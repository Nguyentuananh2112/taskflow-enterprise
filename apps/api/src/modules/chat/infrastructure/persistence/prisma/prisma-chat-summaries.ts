import { Prisma } from '../../../../../generated/prisma/client';
import type {
  ConversationCursor,
  ConversationSummary,
} from '../../../application/ports/chat-conversation.port';
import { effectiveGroupOwners, type ConversationKind } from '../../../domain/chat-conversation';
import { bodyPreview, capUnread } from '../../../domain/chat-message';
import { accessSql, activeSql, effectiveSql, escapeLike, type DbProvider } from './chat-db';

// Phía đọc danh sách hội thoại (T-069a; ADR-145): MỘT trang id theo keyset rồi nạp chi tiết theo LÔ (không N truy vấn
// mỗi hội thoại). Cùng nghĩa với in-memory-chat-summary.ts.

type ConvRow = {
  id: string;
  kind: ConversationKind;
  title: string | null;
  direct_key: string | null;
  workspace_id: string | null;
  created_by_id: string;
  last_message_at: Date | null;
  last_message_id: string | null;
  created_at: Date;
  sort_at: Date;
  ws_name: string | null;
};
type PartRow = {
  conversation_id: string;
  user_id: string;
  role: 'OWNER' | 'MEMBER';
  joined_at: Date;
  effective: boolean;
};

export class PrismaChatSummaries {
  constructor(private readonly db: DbProvider) {}

  async listForUser(
    userId: string,
    now: Date,
    page: { cursor: ConversationCursor | null; limit: number },
  ): Promise<{ items: ConversationSummary[]; next: ConversationCursor | null }> {
    const after = page.cursor
      ? Prisma.sql`AND (COALESCE(c.last_message_at, c.created_at), c.id) < (${page.cursor.at}, ${page.cursor.id}::uuid)`
      : Prisma.empty;
    const rows = await this.#conversations(userId, now, after, page.limit + 1);
    const items = rows.slice(0, page.limit);
    const last = items.at(-1);
    const next = rows.length > page.limit && last ? { at: last.sort_at, id: last.id } : null;
    return { items: await this.#build(items, userId, now), next };
  }

  async summaryFor(
    conversationId: string,
    userId: string,
    now: Date,
  ): Promise<ConversationSummary | null> {
    const rows = await this.#conversations(
      userId,
      now,
      Prisma.sql`AND c.id = ${conversationId}::uuid`,
      1,
    );
    return (await this.#build(rows, userId, now))[0] ?? null;
  }

  async unreadTotal(userId: string, now: Date): Promise<number> {
    const rows = await this.db().$queryRaw<{ id: string }[]>`
      SELECT DISTINCT a.conversation_id AS id FROM (${accessSql(now)}) a
        LEFT JOIN chat_read_states r ON r.conversation_id = a.conversation_id AND r.user_id = ${userId}::uuid
       WHERE a.user_id = ${userId}::uuid AND COALESCE(r.muted, FALSE) = FALSE`;
    const counts = await this.#unread(
      rows.map((r) => r.id),
      userId,
    );
    return [...counts.values()].reduce((n, c) => n + c, 0);
  }

  searchPeople(q: string, limit: number, now: Date): Promise<{ id: string; fullName: string }[]> {
    const pattern = `%${escapeLike(q.trim())}%`;
    return this.db().$queryRaw<{ id: string; fullName: string }[]>`
      SELECT u.id, u.full_name AS "fullName" FROM users u JOIN company_members cm ON cm.user_id = u.id
       WHERE ${activeSql(now)} AND u.full_name ILIKE ${pattern} ESCAPE '\\'
       ORDER BY u.full_name, u.id LIMIT ${limit}`;
  }

  #conversations(userId: string, now: Date, extra: Prisma.Sql, limit: number): Promise<ConvRow[]> {
    return this.db().$queryRaw<ConvRow[]>`
      SELECT c.id, c.kind::text AS kind, c.title, c.direct_key, c.workspace_id, c.created_by_id, c.last_message_at,
             c.last_message_id, c.created_at, COALESCE(c.last_message_at, c.created_at) AS sort_at, w.name AS ws_name
        FROM chat_conversations c
        LEFT JOIN workspaces w ON w.id = c.workspace_id
       WHERE c.id IN (SELECT a.conversation_id FROM (${accessSql(now)}) a WHERE a.user_id = ${userId}::uuid) ${extra}
       ORDER BY COALESCE(c.last_message_at, c.created_at) DESC, c.id DESC
       LIMIT ${limit}`;
  }

  async #build(rows: ConvRow[], userId: string, now: Date): Promise<ConversationSummary[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const [parts, wsCounts, reads, lasts, unread] = await Promise.all([
      this.db().$queryRaw<PartRow[]>`
        SELECT p.conversation_id, p.user_id, p.role::text AS role, p.joined_at, ${effectiveSql(now)} AS effective
          FROM chat_participants p JOIN chat_conversations c ON c.id = p.conversation_id
          LEFT JOIN company_members cm ON cm.user_id = p.user_id LEFT JOIN users u ON u.id = p.user_id
         WHERE p.conversation_id = ANY(${ids}::uuid[])`,
      this.db().$queryRaw<{ id: string; n: number }[]>`
        SELECT a.conversation_id AS id, COUNT(DISTINCT a.user_id)::int AS n
          FROM (${accessSql(now, Prisma.sql`c.id = ANY(${ids}::uuid[]) AND c.kind = 'WORKSPACE'`)}) a
         GROUP BY a.conversation_id`,
      this.db().chatReadState.findMany({ where: { conversationId: { in: ids } } }),
      this.db().$queryRaw<
        {
          id: string;
          sender_id: string;
          body: string | null;
          deleted_at: Date | null;
          created_at: Date;
          n: number;
        }[]
      >`
        SELECT m.id, m.sender_id, m.body, m.deleted_at, m.created_at,
               (SELECT COUNT(*)::int FROM chat_attachments a WHERE a.message_id = m.id) AS n
          FROM chat_messages m
         WHERE m.id = ANY(${rows.flatMap((r) => (r.last_message_id ? [r.last_message_id] : []))}::uuid[])`,
      this.#unread(ids, userId),
    ]);
    const readOf = (c: string, u: string) =>
      reads.find((r) => r.conversationId === c && r.userId === u);
    return rows.map((r) => {
      const ps = parts.filter((p) => p.conversation_id === r.id);
      const peer = r.kind === 'DIRECT' ? (ps.find((p) => p.user_id !== userId) ?? null) : null;
      const view = ps.map((p) => ({
        userId: p.user_id,
        role: p.role,
        joinedAt: p.joined_at,
        effective: p.effective,
      }));
      const last = lasts.find((m) => m.id === r.last_message_id);
      const mine = readOf(r.id, userId);
      return {
        conversation: {
          id: r.id,
          kind: r.kind,
          title: r.title,
          directKey: r.direct_key,
          workspaceId: r.workspace_id,
          createdById: r.created_by_id,
          lastMessageAt: r.last_message_at,
          lastMessageId: r.last_message_id,
          createdAt: r.created_at,
        },
        title: r.kind === 'WORKSPACE' ? r.ws_name : r.title,
        peerId: peer?.user_id ?? null,
        peerActive: peer ? peer.effective : true,
        memberCount:
          r.kind === 'DIRECT'
            ? 2
            : r.kind === 'GROUP'
              ? view.filter((p) => p.effective).length
              : (wsCounts.find((w) => w.id === r.id)?.n ?? 0),
        myRole:
          r.kind === 'GROUP'
            ? effectiveGroupOwners(view).ownerIds.includes(userId)
              ? 'OWNER'
              : 'MEMBER'
            : null,
        lastMessage: last
          ? {
              id: last.id,
              senderId: last.sender_id,
              bodyPreview: bodyPreview(last.body),
              attachmentCount: last.n,
              deleted: last.deleted_at !== null,
              createdAt: last.created_at,
            }
          : null,
        unread: unread.get(r.id) ?? 0,
        muted: mine?.muted ?? false,
        lastReadMessageId: mine?.lastReadMessageId ?? null,
        peerLastReadMessageId: peer
          ? (readOf(r.id, peer.user_id)?.lastReadMessageId ?? null)
          : null,
      };
    });
  }

  /** Tin sau con trỏ, không phải của mình, chưa xóa — đếm tối đa 100 mỗi hội thoại rồi trần 99. */
  async #unread(ids: readonly string[], userId: string): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db().$queryRaw<{ id: string; n: number }[]>`
      SELECT x.id, (
        SELECT COUNT(*)::int FROM (
          SELECT 1 FROM chat_messages m
            LEFT JOIN chat_read_states r ON r.conversation_id = m.conversation_id AND r.user_id = ${userId}::uuid
            LEFT JOIN chat_messages lr ON lr.id = r.last_read_message_id
           WHERE m.conversation_id = x.id AND m.sender_id <> ${userId}::uuid AND m.deleted_at IS NULL
             AND (lr.id IS NULL OR (m.created_at, m.id) > (lr.created_at, lr.id))
           LIMIT 100) t) AS n
        FROM unnest(${ids as string[]}::uuid[]) AS x(id)`;
    return new Map(rows.map((r) => [r.id, capUnread(r.n)]));
  }
}
