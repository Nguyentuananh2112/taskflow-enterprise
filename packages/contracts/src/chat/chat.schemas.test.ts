import { describe, expect, it } from 'vitest';

import {
  AddGroupMembersBody,
  BusinessRule,
  ChatBody,
  ChatMessageNewEvent,
  ChatPeopleQuery,
  ChatTypingPayload,
  ConversationDto,
  CreateGroupBody,
  EditMessageBody,
  ListMessagesQuery,
  MessageDto,
  REALTIME_EVENTS,
  SendMessageBody,
  UploadQuery,
} from '../index';

// Mốc 6 — contract trò chuyện (avatar-chat.md §4, ADR-143…145).
const ID = '0b6f2c1e-7f6a-4c1d-9a3e-2b1c0d9e8f7a';
const ID2 = '1b6f2c1e-7f6a-4c1d-9a3e-2b1c0d9e8f7a';
const NOW = '2026-10-18T08:00:00.000Z';
const user = { id: ID, fullName: 'Mia' };

const message = {
  id: ID,
  conversationId: ID2,
  sender: user,
  clientMsgId: ID2,
  body: 'Chào Vic',
  replyTo: null,
  attachments: [],
  createdAt: NOW,
  editedAt: null,
  deletedAt: null,
};

describe('ChatBody (CH-05)', () => {
  it('NFC + trim; 4 000 code point được, 4 001 không (đếm code point, không UTF-16)', () => {
    expect(ChatBody.parse('  Tiếng  ')).toBe('Tiếng');
    const emoji = '😀'; // 1 code point, 2 code unit
    expect(ChatBody.safeParse(emoji.repeat(4_000)).success).toBe(true);
    expect(ChatBody.safeParse(emoji.repeat(4_001)).success).toBe(false);
  });

  it('nhiều dòng + tab được; ký tự điều khiển khác không', () => {
    expect(ChatBody.safeParse('dòng 1\n\tdòng 2\r\n').success).toBe(true);
    expect(ChatBody.safeParse('a\u0000b').success).toBe(false);
    expect(ChatBody.safeParse('a\u001bb').success).toBe(false);
  });

  it('HTML giữ nguyên văn (web hiển thị text node — SEC-CH-13)', () => {
    expect(ChatBody.parse('<img src=x onerror=alert(1)>')).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('SendMessageBody (ADR-144)', () => {
  it('cần clientMsgId; thân hoặc đính kèm', () => {
    expect(SendMessageBody.safeParse({ clientMsgId: ID, body: 'hi' }).success).toBe(true);
    expect(SendMessageBody.safeParse({ clientMsgId: ID, attachmentIds: [ID2] }).success).toBe(true);
    expect(SendMessageBody.safeParse({ clientMsgId: ID, body: '   ' }).success).toBe(false);
    expect(SendMessageBody.safeParse({ body: 'hi' }).success).toBe(false);
  });

  it('11 đính kèm vẫn qua schema ⇒ server 422 TOO_MANY_ATTACHMENTS (không phải 400)', () => {
    const ids = Array.from(
      { length: 11 },
      (_, i) => `00000000-0000-4000-8000-${i.toString().padStart(12, '0')}`,
    );
    expect(SendMessageBody.safeParse({ clientMsgId: ID, attachmentIds: ids }).success).toBe(true);
  });

  it('đính kèm trùng ⇒ 400 rõ ràng (B soát T-069a)', () => {
    const dup = [ID2, ID2];
    expect(SendMessageBody.safeParse({ clientMsgId: ID, attachmentIds: dup }).success).toBe(false);
  });

  it('strict: trường lạ ⇒ sai', () => {
    expect(SendMessageBody.safeParse({ clientMsgId: ID, body: 'x', senderId: ID }).success).toBe(
      false,
    );
  });

  it('EditMessageBody: thân rỗng ⇒ sai', () => {
    expect(EditMessageBody.safeParse({ body: '' }).success).toBe(false);
    expect(EditMessageBody.safeParse({ body: 'sửa' }).success).toBe(true);
  });
});

describe('nhóm (ADR-143)', () => {
  it('tên 1–80 ký tự một dòng; ≥ 2 người khác; trùng ⇒ sai', () => {
    expect(
      CreateGroupBody.safeParse({ title: 'Dự án Sao Mai', memberIds: [ID, ID2] }).success,
    ).toBe(true);
    expect(CreateGroupBody.safeParse({ title: '', memberIds: [ID, ID2] }).success).toBe(false);
    expect(CreateGroupBody.safeParse({ title: 'x'.repeat(81), memberIds: [ID, ID2] }).success).toBe(
      false,
    );
    expect(CreateGroupBody.safeParse({ title: 'a\nb', memberIds: [ID, ID2] }).success).toBe(false);
    expect(CreateGroupBody.safeParse({ title: 'x', memberIds: [ID] }).success).toBe(false);
    expect(CreateGroupBody.safeParse({ title: 'x', memberIds: [ID, ID] }).success).toBe(false);
  });

  it('100 người khác vẫn qua schema ⇒ server 422 GROUP_TOO_LARGE (CH-16)', () => {
    const ids = Array.from(
      { length: 100 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    );
    expect(CreateGroupBody.safeParse({ title: 'x', memberIds: ids }).success).toBe(true);
    expect(AddGroupMembersBody.safeParse({ userIds: ids }).success).toBe(true);
  });
});

describe('query', () => {
  it('ListMessagesQuery: before HOẶC after, không cả hai; limit ≤ 200', () => {
    expect(ListMessagesQuery.safeParse({ before: ID }).success).toBe(true);
    expect(ListMessagesQuery.safeParse({ after: ID, limit: '200' }).success).toBe(true);
    expect(ListMessagesQuery.safeParse({ before: ID, after: ID2 }).success).toBe(false);
    expect(ListMessagesQuery.safeParse({ limit: '201' }).success).toBe(false);
  });

  it('chat/people: q 1–100 bắt buộc', () => {
    expect(ChatPeopleQuery.safeParse({ q: 'mi' }).success).toBe(true);
    expect(ChatPeopleQuery.safeParse({ q: '  ' }).success).toBe(false);
    expect(ChatPeopleQuery.safeParse({}).success).toBe(false);
  });

  it('upload ?as=image|file', () => {
    expect(UploadQuery.safeParse({ as: 'image' }).success).toBe(true);
    expect(UploadQuery.safeParse({ as: 'video' }).success).toBe(false);
  });
});

describe('DTO', () => {
  it('ConversationDto: unread trần 99', () => {
    const conv = {
      id: ID,
      kind: 'DIRECT',
      title: null,
      workspaceId: null,
      peer: user,
      memberCount: 2,
      lastMessage: null,
      lastMessageAt: null,
      unread: 99,
      muted: false,
      canSend: true,
      lastReadMessageId: null,
      peerLastReadMessageId: ID2,
      myRole: null,
    };
    expect(ConversationDto.safeParse(conv).success).toBe(true);
    expect(ConversationDto.safeParse({ ...conv, unread: 100 }).success).toBe(false);
    // con trỏ đọc bắt buộc có mặt (null được) — "Đã xem" / vạch chưa đọc sau khi tải lại trang
    const { peerLastReadMessageId: _p, ...withoutPeer } = conv;
    expect(ConversationDto.safeParse(withoutPeer).success).toBe(false);
  });

  it('MessageDto + tin đã xóa (body null)', () => {
    expect(MessageDto.safeParse(message).success).toBe(true);
    expect(MessageDto.safeParse({ ...message, body: null, deletedAt: NOW }).success).toBe(true);
  });
});

describe('realtime + luật', () => {
  it('chat:message:new bọc {message}; chat:typing client→server chỉ conversationId', () => {
    expect(REALTIME_EVENTS.chatMessageNew).toBe('chat:message:new');
    expect(
      ChatMessageNewEvent.safeParse({
        eventId: ID,
        type: 'chat:message:new',
        occurredAt: NOW,
        actorId: ID,
        originClientId: null,
        data: { message },
      }).success,
    ).toBe(true);
    expect(ChatTypingPayload.safeParse({ conversationId: ID }).success).toBe(true);
    expect(ChatTypingPayload.safeParse({ conversationId: ID, userId: ID }).success).toBe(false);
  });

  it('mã 422 chat thuộc BusinessRule', () => {
    for (const rule of [
      'SELF_DIRECT',
      'RECIPIENT_INACTIVE',
      'NOT_ACTIVE_MEMBER',
      'NOT_GROUP',
      'EDIT_WINDOW_PASSED',
      'REPLY_OTHER_CONVERSATION',
      'GROUP_TOO_LARGE',
      'TOO_MANY_ATTACHMENTS',
      'IDEMPOTENCY_KEY_REUSED',
    ]) {
      expect(BusinessRule.options).toContain(rule);
    }
  });
});
