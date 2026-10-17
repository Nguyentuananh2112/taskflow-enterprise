import type {
  ConversationCursor,
  ConversationRecord,
  ConversationSummary,
  IChatConversationStore,
  ParticipantRecord,
} from '../../../application/ports/chat-conversation.port';
import type { ChatParticipantRole } from '../../../domain/chat-conversation';
import type { ConversationRow, InMemoryChatState } from './in-memory-chat-state';
import { byListOrder, searchPeopleOf, sortAt, summaryOf, unreadOf } from './in-memory-chat-summary';

/** IChatConversationStore trong bộ nhớ (dev / test — cùng hợp đồng với PrismaChatConversationStore, T-069a). */
export class InMemoryChatConversationStore implements IChatConversationStore {
  constructor(private readonly s: InMemoryChatState) {}

  async getOrCreateDirect(input: {
    id: string;
    directKey: string;
    createdById: string;
    userIds: readonly [string, string];
    at: Date;
  }) {
    const found = this.#find((c) => c.directKey === input.directKey);
    if (found) return { conversation: { ...found }, created: false };
    const row = this.#insert({ ...input, kind: 'DIRECT', title: null, workspaceId: null });
    for (const userId of input.userIds)
      await this.#upsertParticipant(row.id, userId, 'MEMBER', input.at);
    return { conversation: { ...row }, created: true };
  }

  getOrCreateWorkspace(input: { id: string; workspaceId: string; createdById: string; at: Date }) {
    const found = this.#find((c) => c.workspaceId === input.workspaceId);
    if (found) return Promise.resolve({ conversation: { ...found }, created: false });
    const row = this.#insert({ ...input, kind: 'WORKSPACE', title: null, directKey: null });
    return Promise.resolve({ conversation: { ...row }, created: true });
  }

  async createGroup(input: {
    id: string;
    title: string;
    createdById: string;
    memberIds: readonly string[];
    at: Date;
  }): Promise<ConversationRecord> {
    const row = this.#insert({ ...input, kind: 'GROUP', directKey: null, workspaceId: null });
    await this.#upsertParticipant(row.id, input.createdById, 'OWNER', input.at);
    for (const userId of input.memberIds)
      await this.#upsertParticipant(row.id, userId, 'MEMBER', input.at);
    return { ...row };
  }

  findById(id: string): Promise<ConversationRecord | null> {
    const c = this.s.data.conversations.get(id);
    return Promise.resolve(c ? { ...c } : null);
  }

  lock(): Promise<void> {
    return Promise.resolve(); // transaction InMemory đã tuần tự
  }

  rename(id: string, title: string): Promise<void> {
    const c = this.s.data.conversations.get(id);
    if (c) c.title = title;
    return Promise.resolve();
  }

  async participants(conversationId: string, now: Date): Promise<ParticipantRecord[]> {
    const c = this.s.data.conversations.get(conversationId);
    if (!c) return [];
    const rows = await Promise.all(
      [...this.s.participantsOf(conversationId).values()].map(async (p) => ({
        ...p,
        effective: await this.s.isEffective(c.kind, p, now),
      })),
    );
    return rows.sort(
      (a, b) => a.joinedAt.getTime() - b.joinedAt.getTime() || cmp(a.userId, b.userId),
    );
  }

  async addParticipants(
    conversationId: string,
    userIds: readonly string[],
    at: Date,
  ): Promise<void> {
    for (const userId of userIds)
      await this.#upsertParticipant(conversationId, userId, 'MEMBER', at);
  }

  markLeft(conversationId: string, userId: string, at: Date): Promise<void> {
    const p = this.s.participantsOf(conversationId).get(userId);
    if (p && p.leftAt === null) p.leftAt = at;
    return Promise.resolve();
  }

  setRole(conversationId: string, userId: string, role: ChatParticipantRole): Promise<void> {
    const p = this.s.participantsOf(conversationId).get(userId);
    if (p) p.role = role;
    return Promise.resolve();
  }

  async canAccess(conversationId: string, userId: string, now: Date): Promise<boolean> {
    return (await this.s.accessIds(conversationId, now)).includes(userId);
  }

  async isWorkspaceMember(workspaceId: string, userId: string, now: Date): Promise<boolean> {
    const ws = await this.s.dir.workspace(workspaceId);
    if (ws?.active !== true) return false;
    if (!(await this.s.dir.workspaceMemberIds(workspaceId)).includes(userId)) return false;
    return this.s.isActive(userId, now);
  }

  recipientIds(conversationId: string, now: Date): Promise<string[]> {
    return this.s.accessIds(conversationId, now);
  }

  async activeUserIds(userIds: readonly string[], now: Date): Promise<Set<string>> {
    return new Set(await this.s.activeOf(userIds, now));
  }

  async listForUser(
    userId: string,
    now: Date,
    page: { cursor: ConversationCursor | null; limit: number },
  ): Promise<{ items: ConversationSummary[]; next: ConversationCursor | null }> {
    const visible = (await this.#visible(userId, now)).filter((c) => {
      if (!page.cursor) return true;
      const t = sortAt(c).getTime() - page.cursor.at.getTime();
      return t < 0 || (t === 0 && c.id < page.cursor.id);
    });
    const rows = visible.slice(0, page.limit);
    const last = rows.at(-1);
    const next = visible.length > page.limit && last ? { at: sortAt(last), id: last.id } : null;
    return { items: await Promise.all(rows.map((c) => summaryOf(this.s, c, userId, now))), next };
  }

  async summaryFor(
    conversationId: string,
    userId: string,
    now: Date,
  ): Promise<ConversationSummary | null> {
    const c = this.s.data.conversations.get(conversationId);
    if (!c || !(await this.s.accessIds(c.id, now)).includes(userId)) return null;
    return summaryOf(this.s, c, userId, now);
  }

  async unreadTotal(userId: string, now: Date): Promise<number> {
    return (await this.#visible(userId, now))
      .filter((c) => !this.s.read(c.id, userId).muted)
      .reduce((n, c) => n + unreadOf(this.s, c, userId), 0);
  }

  searchPeople(q: string, limit: number, now: Date): Promise<{ id: string; fullName: string }[]> {
    return searchPeopleOf(this.s, q, limit, now);
  }

  async markLeftForNonMembers(now: Date, limit: number): Promise<number> {
    let n = 0;
    for (const [conversationId, parts] of this.s.data.participants) {
      if (this.s.data.conversations.get(conversationId)?.kind === 'WORKSPACE') continue;
      for (const p of parts.values()) {
        if (n >= limit) return n;
        if (p.leftAt === null && (await this.s.dir.member(p.userId)) === null) {
          p.leftAt = now;
          n++;
        }
      }
    }
    return n;
  }

  async #visible(userId: string, now: Date): Promise<ConversationRow[]> {
    const all = [...this.s.data.conversations.values()];
    const ok = await Promise.all(
      all.map(async (c) => (await this.s.accessIds(c.id, now)).includes(userId)),
    );
    return all.filter((_, i) => ok[i]).sort(byListOrder);
  }

  #find(pred: (c: ConversationRow) => boolean): ConversationRow | undefined {
    return [...this.s.data.conversations.values()].find(pred);
  }

  #insert(
    r: Omit<ConversationRow, 'lastMessageAt' | 'lastMessageId' | 'createdAt'> & { at: Date },
  ): ConversationRow {
    const row: ConversationRow = {
      id: r.id,
      kind: r.kind,
      title: r.title,
      directKey: r.directKey,
      workspaceId: r.workspaceId,
      createdById: r.createdById,
      lastMessageAt: null,
      lastMessageId: null,
      createdAt: r.at,
    };
    this.s.data.conversations.set(row.id, row);
    return row;
  }

  async #upsertParticipant(
    conversationId: string,
    userId: string,
    role: ChatParticipantRole,
    at: Date,
  ) {
    const parts = this.s.participantsOf(conversationId);
    const p = parts.get(userId);
    const kind = this.s.data.conversations.get(conversationId)?.kind ?? 'GROUP';
    // Đang hiệu lực ⇒ giữ joined_at / role. Đã rời, HOẶC left_at NULL nhưng hết hiệu lực (nhận lại — dòng
    // company_members mới) ⇒ thêm lại với joined_at mới (ADR-143).
    if (p && (await this.s.isEffective(kind, p, at))) return;
    parts.set(userId, { userId, role, joinedAt: at, leftAt: null });
  }
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
