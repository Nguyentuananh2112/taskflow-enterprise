import type {
  ChatPersonDto,
  ConversationDetailDto,
  ConversationDto,
  UnreadCountDto,
} from '@taskflow/contracts';

import { conversationDetail, type ChatDeps } from './chat-context';
import { conversationDto, summaryUserIds } from './chat-dto';
import type { ConversationCursor } from './ports/chat-conversation.port';

/** Trần kết quả danh bạ `chat/people` (ADR-143). */
export const CHAT_PEOPLE_LIMIT = 20;

/** Phía đọc hội thoại (ADR-143/145). Chỉ đọc ⇒ không transaction; "thuộc công ty" theo giờ nghiệp vụ. */
export class ConversationQueries {
  constructor(private readonly d: Pick<ChatDeps, 'conversations' | 'users' | 'clock'>) {}

  /** `GET chat/conversations`: keyset `COALESCE(last_message_at, created_at) DESC, id DESC`. */
  async list(input: {
    userId: string;
    cursor: ConversationCursor | null;
    limit: number;
  }): Promise<{ items: ConversationDto[]; next: ConversationCursor | null }> {
    const page = await this.d.conversations.listForUser(input.userId, this.d.clock.now(), {
      cursor: input.cursor,
      limit: input.limit,
    });
    const refs = await this.d.users.refsOf(summaryUserIds(page.items));
    return { items: page.items.map((s) => conversationDto(s, refs)), next: page.next };
  }

  detail(input: { userId: string; conversationId: string }): Promise<ConversationDetailDto> {
    return conversationDetail(this.d, input.conversationId, input.userId, this.d.clock.now());
  }

  /** Badge header: bỏ hội thoại tắt tiếng, mỗi hội thoại trần 99 (ADR-145). */
  async unreadCount(userId: string): Promise<UnreadCountDto> {
    return { total: await this.d.conversations.unreadTotal(userId, this.d.clock.now()) };
  }

  /** Danh bạ nội bộ (R49): người thuộc công ty hoạt động; không email, không người chờ kích hoạt / đã rời. */
  async people(q: string): Promise<ChatPersonDto[]> {
    const found = await this.d.conversations.searchPeople(q, CHAT_PEOPLE_LIMIT, this.d.clock.now());
    const refs = await this.d.users.refsOf(found.map((p) => p.id));
    return found.map((p) => ({
      id: p.id,
      fullName: p.fullName,
      avatarUrl: refs.get(p.id)?.avatarUrl ?? null,
    }));
  }
}
