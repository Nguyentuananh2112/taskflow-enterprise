import { CHAT_GROUP_MAX_OTHERS, CHAT_UNREAD_CAP } from '@taskflow/contracts/chat';
import { CHAT_MAX_ATTACHMENTS } from '@taskflow/contracts/common';
import { describe, expect, it } from 'vitest';

import { GROUP_MAX_OTHERS } from '../domain/chat-conversation';
import { MAX_ATTACHMENTS, UNREAD_CAP } from '../domain/chat-message';

// Domain không import contracts (ADR-043) ⇒ giữ hằng số cục bộ, khóa bằng parity ở đây (G 18/10).
describe('Parity: hằng số domain chat ↔ @taskflow/contracts', () => {
  it('trần nhóm, số tệp / tin, trần unread', () => {
    expect(GROUP_MAX_OTHERS).toBe(CHAT_GROUP_MAX_OTHERS);
    expect(MAX_ATTACHMENTS).toBe(CHAT_MAX_ATTACHMENTS);
    expect(UNREAD_CAP).toBe(CHAT_UNREAD_CAP);
  });
});
