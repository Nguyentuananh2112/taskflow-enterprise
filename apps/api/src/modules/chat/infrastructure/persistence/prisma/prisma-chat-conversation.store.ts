import { Prisma } from '../../../../../generated/prisma/client';
import type {
  ConversationCursor,
  ConversationRecord,
  ConversationSummary,
  IChatConversationStore,
  ParticipantRecord,
} from '../../../application/ports/chat-conversation.port';
import type { ChatParticipantRole, ConversationKind } from '../../../domain/chat-conversation';
import { effectiveSql, type DbProvider } from './chat-db';
import { PrismaChatAccess } from './prisma-chat-access';
import { toRecord } from './prisma-chat-rows';
import { PrismaChatSummaries } from './prisma-chat-summaries';

/** IChatConversationStore trên Postgres (T-069a). Tạo-hoặc-lấy = INSERT … ON CONFLICT DO NOTHING rồi đọc. */
export class PrismaChatConversationStore implements IChatConversationStore {
  readonly #summaries: PrismaChatSummaries;
  readonly #access: PrismaChatAccess;

  constructor(private readonly db: DbProvider) {
    this.#summaries = new PrismaChatSummaries(db);
    this.#access = new PrismaChatAccess(db);
  }

  async getOrCreateDirect(input: {
    id: string;
    directKey: string;
    createdById: string;
    userIds: readonly [string, string];
    at: Date;
  }) {
    const created = await this.#insert(
      input.id,
      'DIRECT',
      null,
      input.directKey,
      null,
      input.createdById,
      input.at,
      Prisma.sql`ON CONFLICT (direct_key) DO NOTHING`,
    );
    if (created) await this.addParticipants(input.id, input.userIds, input.at);
    const row = await this.db().chatConversation.findUniqueOrThrow({
      where: { directKey: input.directKey },
    });
    return { conversation: toRecord(row), created };
  }

  async getOrCreateWorkspace(input: {
    id: string;
    workspaceId: string;
    createdById: string;
    at: Date;
  }) {
    const created = await this.#insert(
      input.id,
      'WORKSPACE',
      null,
      null,
      input.workspaceId,
      input.createdById,
      input.at,
      Prisma.sql`ON CONFLICT (workspace_id) DO NOTHING`,
    );
    const row = await this.db().chatConversation.findUniqueOrThrow({
      where: { workspaceId: input.workspaceId },
    });
    return { conversation: toRecord(row), created };
  }

  async createGroup(input: {
    id: string;
    title: string;
    createdById: string;
    memberIds: readonly string[];
    at: Date;
  }): Promise<ConversationRecord> {
    await this.#insert(
      input.id,
      'GROUP',
      input.title,
      null,
      null,
      input.createdById,
      input.at,
      Prisma.empty,
    );
    await this.db().chatParticipant.createMany({
      data: [
        { conversationId: input.id, userId: input.createdById, role: 'OWNER', joinedAt: input.at },
        ...input.memberIds.map((userId) => ({
          conversationId: input.id,
          userId,
          joinedAt: input.at,
        })),
      ],
    });
    return toRecord(
      await this.db().chatConversation.findUniqueOrThrow({ where: { id: input.id } }),
    );
  }

  async findById(id: string): Promise<ConversationRecord | null> {
    const row = await this.db().chatConversation.findUnique({ where: { id } });
    return row ? toRecord(row) : null;
  }

  async lock(id: string): Promise<void> {
    await this.db().$queryRaw`SELECT id FROM chat_conversations WHERE id = ${id}::uuid FOR UPDATE`;
  }

  async rename(id: string, title: string, at: Date): Promise<void> {
    await this.db().chatConversation.update({ where: { id }, data: { title, updatedAt: at } });
  }

  participants(conversationId: string, now: Date): Promise<ParticipantRecord[]> {
    return this.db().$queryRaw<ParticipantRecord[]>`
      SELECT p.user_id AS "userId", p.role::text AS role, p.joined_at AS "joinedAt", p.left_at AS "leftAt",
             ${effectiveSql(now)} AS effective
        FROM chat_participants p
        JOIN chat_conversations c ON c.id = p.conversation_id
        LEFT JOIN company_members cm ON cm.user_id = p.user_id
        LEFT JOIN users u ON u.id = p.user_id
       WHERE p.conversation_id = ${conversationId}::uuid
       ORDER BY p.joined_at, p.user_id`;
  }

  /**
   * Thêm mới, hoặc thêm lại: dòng cũ ĐÃ RỜI hoặc HẾT HIỆU LỰC (nhận lại — company_members mới tạo sau joined_at) ⇒
   * joined_at = at, left_at NULL, MEMBER. Dòng đang hiệu lực giữ nguyên (ADR-143).
   */
  async addParticipants(
    conversationId: string,
    userIds: readonly string[],
    at: Date,
  ): Promise<void> {
    if (userIds.length === 0) return;
    await this.db().$executeRaw`
      INSERT INTO chat_participants (conversation_id, user_id, role, joined_at)
      SELECT ${conversationId}::uuid, x.id, 'MEMBER', ${at} FROM unnest(${userIds as string[]}::uuid[]) AS x(id)
      ON CONFLICT (conversation_id, user_id) DO UPDATE
         SET joined_at = EXCLUDED.joined_at, left_at = NULL, role = 'MEMBER'
       WHERE chat_participants.left_at IS NOT NULL
          OR chat_participants.joined_at < COALESCE(
               (SELECT cm.created_at FROM company_members cm WHERE cm.user_id = chat_participants.user_id), 'infinity')`;
  }

  async markLeft(conversationId: string, userId: string, at: Date): Promise<void> {
    await this.db().chatParticipant.updateMany({
      where: { conversationId, userId, leftAt: null },
      data: { leftAt: at },
    });
  }

  async setRole(conversationId: string, userId: string, role: ChatParticipantRole): Promise<void> {
    await this.db().chatParticipant.updateMany({
      where: { conversationId, userId },
      data: { role },
    });
  }

  canAccess(conversationId: string, userId: string, now: Date): Promise<boolean> {
    return this.#access.canAccess(conversationId, userId, now);
  }

  isWorkspaceMember(workspaceId: string, userId: string, now: Date): Promise<boolean> {
    return this.#access.isWorkspaceMember(workspaceId, userId, now);
  }

  recipientIds(conversationId: string, now: Date): Promise<string[]> {
    return this.#access.recipientIds(conversationId, now);
  }

  activeUserIds(userIds: readonly string[], now: Date): Promise<Set<string>> {
    return this.#access.activeUserIds(userIds, now);
  }

  listForUser(
    userId: string,
    now: Date,
    page: { cursor: ConversationCursor | null; limit: number },
  ) {
    return this.#summaries.listForUser(userId, now, page);
  }

  summaryFor(
    conversationId: string,
    userId: string,
    now: Date,
  ): Promise<ConversationSummary | null> {
    return this.#summaries.summaryFor(conversationId, userId, now);
  }

  unreadTotal(userId: string, now: Date): Promise<number> {
    return this.#summaries.unreadTotal(userId, now);
  }

  searchPeople(q: string, limit: number, now: Date) {
    return this.#summaries.searchPeople(q, limit, now);
  }

  markLeftForNonMembers(now: Date, limit: number): Promise<number> {
    return this.#access.markLeftForNonMembers(now, limit);
  }

  async #insert(
    id: string,
    kind: ConversationKind,
    title: string | null,
    directKey: string | null,
    workspaceId: string | null,
    createdById: string,
    at: Date,
    onConflict: Prisma.Sql,
  ): Promise<boolean> {
    const n = await this.db().$executeRaw`
      INSERT INTO chat_conversations (id, kind, title, direct_key, workspace_id, created_by_id, created_at, updated_at)
      VALUES (${id}::uuid, ${kind}::chat_conversation_kind, ${title}, ${directKey}, ${workspaceId}::uuid,
              ${createdById}::uuid, ${at}, ${at})
      ${onConflict}`;
    return n === 1;
  }
}
