import type { MessageDto } from '@taskflow/contracts';

import { accessibleConversation, type ChatDeps } from './chat-context';
import { messageDto, messageUserIds } from './chat-dto';

/**
 * `GET chat/conversations/:id/messages` (ADR-144): keyset `(created_at, id)` — `before` (cũ hơn, ≤ 50), `after` (bù khi
 * nối lại, ≤ 200), không cả hai ⇒ trang mới nhất. Luôn tăng dần. Không phải người tham gia ⇒ 404.
 */
export class MessageQueries {
  constructor(
    private readonly d: Pick<ChatDeps, 'conversations' | 'messages' | 'users' | 'media' | 'clock'>,
  ) {}

  async list(input: {
    userId: string;
    conversationId: string;
    before?: string | undefined;
    after?: string | undefined;
    limit: number;
  }): Promise<{ items: MessageDto[]; hasMore: boolean }> {
    await accessibleConversation(this.d, input.conversationId, input.userId, this.d.clock.now());
    const page = await this.d.messages.page(input.conversationId, {
      ...(input.before ? { before: input.before } : {}),
      ...(input.after ? { after: input.after } : {}),
      limit: input.limit,
    });
    const refs = await this.d.users.refsOf(messageUserIds(page.items));
    return {
      items: page.items.map((m) => messageDto(m, refs, this.d.media)),
      hasMore: page.hasMore,
    };
  }
}
