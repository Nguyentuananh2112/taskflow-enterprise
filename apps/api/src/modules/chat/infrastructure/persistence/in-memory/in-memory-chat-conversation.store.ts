import type {
  ConversationCursor,
  ConversationRecord,
  ConversationSummary,
  IChatConversationStore,
  ParticipantRecord,
} from '../../../application/ports/chat-conversation.port';
import type { ChatParticipantRole } from '../../../domain/chat-conversation';
import type { ConversationRow, InMemoryChatState } from './in-memory-chat-state';
import { byListOrder, sortAt, summaryOf, unreadOf } from './in-memory-chat-summary';

/** IChatConversationStore trong bộ nhớ (dev / test — cùng hợp đồng với PrismaChatConversationStore, T-069a). */
export class InMemoryChatConversationStore implements IChatConversationStore {
  constructor(private readonly s: InMemoryChatState) {}

  getOrCreateDirect(input: {
    id: string;
    directKey: string;
    createdById: string;
    userIds: readonly [string, string];
    at: Date;
  }) {
    const found = this.#find((c) => c.directKey === input.directKey);
    if (found) return Promise.resolve({ conversation: { ...found }, created: false });
    const row = this.#insert({ ...input, kind: 'DIRECT', title: null, workspaceId: null });
    for (const userId of input.userIds) this.#upsertParticipant(row.id, userId, 'MEMBER', input.at);
    return Promise.resolve({ conversation: { ...row }, created: true });
  }

  getOrCreateWorkspace(input: { id: string; workspaceId: string; createdById: string; at: Date }) {
    const found = this.#find((c) => c.workspaceId === input.workspaceId);
    if (found) return Promise.resolve({ conversation: { ...found }, created: false });
    const row = this.#insert({ ...input, kind: 'WORKSPACE', title: null, directKey: null });
    return Promise.resolve({ conversation: { ...row }, created: true });
  }

  createGroup(input: {
    id: string;
    title: string;
    createdById: string;
    memberIds: readonly string[];
    at: Date;
  }): Promise<ConversationRecord> {
    const row = this.#insert({ ...input, kind: 'GROUP', directKey: null, workspaceId: null });
    this.#upsertParticipant(row.id, input.createdById, 'OWNER', input.at);
    for (const userId of input.memberIds)
      this.#upsertParticipant(row.id, userId, 'MEMBER', input.at);
    return Promise.resolve({ ...row });
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

  participants(conversationId: string, now: Date): Promise<ParticipantRecord[]> {
    const c = this.s.data.conversations.get(conversationId);
    if (!c) return Promise.resolve([]);
    const rows = [...this.s.participantsOf(conversationId).values()]
      .map((p) => ({ ...p, effective: this.s.isEffective(c.kind, p, now) }))
      .sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime() || cmp(a.userId, b.userId));
    return Promise.resolve(rows);
  }

  addParticipants(conversationId: string, userIds: readonly string[], at: Date): Promise<void> {
    for (const userId of userIds) this.#upsertParticipant(conversationId, userId, 'MEMBER', at);
    return Promise.resolve();
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

  canAccess(conversationId: string, userId: string, now: Date): Promise<boolean> {
    return Promise.resolve(this.s.accessIds(conversationId, now).includes(userId));
  }

  isWorkspaceMember(workspaceId: string, userId: string, now: Date): Promise<boolean> {
    const ws = this.s.dir.workspace(workspaceId);
    const ok =
      ws?.active === true &&
      this.s.dir.workspaceMemberIds(workspaceId).includes(userId) &&
      this.s.isActive(userId, now);
    return Promise.resolve(ok);
  }

  recipientIds(conversationId: string, now: Date): Promise<string[]> {
    return Promise.resolve(this.s.accessIds(conversationId, now));
  }

  activeUserIds(userIds: readonly string[], now: Date): Promise<Set<string>> {
    return Promise.resolve(new Set(userIds.filter((id) => this.s.isActive(id, now))));
  }

  listForUser(
    userId: string,
    now: Date,
    page: { cursor: ConversationCursor | null; limit: number },
  ): Promise<{ items: ConversationSummary[]; next: ConversationCursor | null }> {
    const visible = this.#visible(userId, now).filter((c) => {
      if (!page.cursor) return true;
      const t = sortAt(c).getTime() - page.cursor.at.getTime();
      return t < 0 || (t === 0 && c.id < page.cursor.id);
    });
    const rows = visible.slice(0, page.limit);
    const last = rows.at(-1);
    const next = visible.length > page.limit && last ? { at: sortAt(last), id: last.id } : null;
    return Promise.resolve({ items: rows.map((c) => summaryOf(this.s, c, userId, now)), next });
  }

  summaryFor(
    conversationId: string,
    userId: string,
    now: Date,
  ): Promise<ConversationSummary | null> {
    const c = this.s.data.conversations.get(conversationId);
    if (!c || !this.s.accessIds(c.id, now).includes(userId)) return Promise.resolve(null);
    return Promise.resolve(summaryOf(this.s, c, userId, now));
  }

  unreadTotal(userId: string, now: Date): Promise<number> {
    const total = this.#visible(userId, now)
      .filter((c) => !this.s.read(c.id, userId).muted)
      .reduce((n, c) => n + unreadOf(this.s, c, userId), 0);
    return Promise.resolve(total);
  }

  searchPeople(q: string, limit: number, now: Date): Promise<{ id: string; fullName: string }[]> {
    const needle = q.trim().toLowerCase();
    const out: { id: string; fullName: string }[] = [];
    for (const id of this.s.dir.userIds()) {
      const u = this.s.dir.user(id);
      if (!u || !this.s.isActive(id, now) || !u.fullName.toLowerCase().includes(needle)) continue;
      out.push({ id, fullName: u.fullName });
    }
    out.sort((a, b) => cmp(a.fullName, b.fullName) || cmp(a.id, b.id));
    return Promise.resolve(out.slice(0, limit));
  }

  markLeftForNonMembers(now: Date, limit: number): Promise<number> {
    let n = 0;
    for (const [conversationId, parts] of this.s.data.participants) {
      if (this.s.data.conversations.get(conversationId)?.kind === 'WORKSPACE') continue;
      for (const p of parts.values()) {
        if (n >= limit) return Promise.resolve(n);
        if (p.leftAt === null && this.s.dir.member(p.userId) === null) {
          p.leftAt = now;
          n++;
        }
      }
    }
    return Promise.resolve(n);
  }

  #visible(userId: string, now: Date): ConversationRow[] {
    return [...this.s.data.conversations.values()]
      .filter((c) => this.s.accessIds(c.id, now).includes(userId))
      .sort(byListOrder);
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

  #upsertParticipant(conversationId: string, userId: string, role: ChatParticipantRole, at: Date) {
    const parts = this.s.participantsOf(conversationId);
    const p = parts.get(userId);
    const kind = this.s.data.conversations.get(conversationId)?.kind ?? 'GROUP';
    // Đang hiệu lực ⇒ giữ joined_at / role. Đã rời, HOẶC left_at NULL nhưng hết hiệu lực (nhận lại — dòng
    // company_members mới) ⇒ thêm lại với joined_at mới (ADR-143).
    if (p && this.s.isEffective(kind, p, at)) return;
    parts.set(userId, { userId, role, joinedAt: at, leftAt: null });
  }
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
