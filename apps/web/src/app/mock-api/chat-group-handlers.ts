import {
  AddGroupMembersBody,
  CHAT_GROUP_MAX_OTHERS,
  ConversationDetailDto,
  ConversationDto,
  RenameGroupBody,
  TransferOwnerBody,
} from '@taskflow/contracts/chat';
import { http, type HttpHandler } from 'msw';

import { invitees, loadConversation, rule } from './chat-handlers';
import type { Conversation, MockChat } from './mock-chat';
import type { MockDb } from './mock-db';
import { requireCompany } from './mock-guard';
import { fail, noContent, ok, parseBody } from './respond';

// Quản trị nhóm của mock chat (avatar-chat.md §4, ADR-143): đổi tên, thêm / bớt, giao OWNER (chỉ OWNER), rời (thành
// viên). Không phải GROUP ⇒ 422 NOT_GROUP; rời / bị bớt ⇒ mất quyền đọc cả lịch sử.

export function createChatGroupHandlers(
  baseUrl: string,
  db: MockDb,
  chat: MockChat,
): HttpHandler[] {
  const url = (path: string) => `${baseUrl}/chat${path}`;
  const dto = (conv: Conversation, viewer: string) => chat.toDto(conv, viewer);
  const checkInvitees = invitees(db, chat);
  /** GROUP + OWNER (thao tác quản trị nhóm). */
  const asOwner = (conv: Conversation, userId: string) => {
    if (conv.kind !== 'GROUP') return rule('NOT_GROUP');
    return chat.roleOf(conv, userId) === 'OWNER' ? null : fail(403, 'FORBIDDEN_ACCESS');
  };
  return [
    http.patch(url('/conversations/:id'), async ({ request, params }) => {
      const ctx = requireCompany(request, db);
      if (ctx.response) return ctx.response;
      const loaded = loadConversation(chat, ctx.ok.user.id, params.id);
      if (loaded.response) return loaded.response;
      const denied = asOwner(loaded.conv, ctx.ok.user.id);
      if (denied) return denied;
      const body = await parseBody(request, RenameGroupBody);
      if (body.response) return body.response;
      loaded.conv.title = body.data.title;
      return ok(ConversationDto, dto(loaded.conv, ctx.ok.user.id));
    }),

    http.post(url('/conversations/:id/members'), async ({ request, params }) => {
      const ctx = requireCompany(request, db);
      if (ctx.response) return ctx.response;
      const loaded = loadConversation(chat, ctx.ok.user.id, params.id);
      if (loaded.response) return loaded.response;
      const denied = asOwner(loaded.conv, ctx.ok.user.id);
      if (denied) return denied;
      const body = await parseBody(request, AddGroupMembersBody);
      if (body.response) return body.response;
      const current = chat.memberIds(loaded.conv);
      const added = body.data.userIds.filter((id) => !current.includes(id));
      if (current.length - 1 + added.length > CHAT_GROUP_MAX_OTHERS) return rule('GROUP_TOO_LARGE');
      const bad = checkInvitees(added);
      if (bad) return bad;
      added.forEach((id) => chat.addParticipant(loaded.conv.id, id, 'MEMBER'));
      return ok(ConversationDetailDto, chat.toDetail(loaded.conv, ctx.ok.user.id));
    }),

    http.delete(url('/conversations/:id/members/:userId'), ({ request, params }) => {
      const ctx = requireCompany(request, db);
      if (ctx.response) return ctx.response;
      const loaded = loadConversation(chat, ctx.ok.user.id, params.id);
      if (loaded.response) return loaded.response;
      const denied = asOwner(loaded.conv, ctx.ok.user.id);
      if (denied) return denied;
      const target = String(params.userId);
      if (!chat.isMember(loaded.conv, target) || target === ctx.ok.user.id) {
        return fail(404, 'RESOURCE_NOT_FOUND', { resource: 'member' });
      }
      chat.removeParticipant(loaded.conv.id, target);
      return noContent();
    }),

    http.put(url('/conversations/:id/owner'), async ({ request, params }) => {
      const ctx = requireCompany(request, db);
      if (ctx.response) return ctx.response;
      const loaded = loadConversation(chat, ctx.ok.user.id, params.id);
      if (loaded.response) return loaded.response;
      const denied = asOwner(loaded.conv, ctx.ok.user.id);
      if (denied) return denied;
      const body = await parseBody(request, TransferOwnerBody);
      if (body.response) return body.response;
      if (!chat.isMember(loaded.conv, body.data.userId)) return rule('NOT_ACTIVE_MEMBER');
      chat.setRole(loaded.conv.id, ctx.ok.user.id, 'MEMBER');
      chat.setRole(loaded.conv.id, body.data.userId, 'OWNER');
      return ok(ConversationDetailDto, chat.toDetail(loaded.conv, ctx.ok.user.id));
    }),

    http.post(url('/conversations/:id/leave'), ({ request, params }) => {
      const ctx = requireCompany(request, db);
      if (ctx.response) return ctx.response;
      const loaded = loadConversation(chat, ctx.ok.user.id, params.id);
      if (loaded.response) return loaded.response;
      if (loaded.conv.kind !== 'GROUP') return rule('NOT_GROUP');
      chat.removeParticipant(loaded.conv.id, ctx.ok.user.id);
      return noContent();
    }),
  ];
}
