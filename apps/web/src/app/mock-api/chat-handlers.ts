import {
  CHAT_GROUP_MAX_OTHERS,
  ChatPeopleQuery,
  ChatPersonDto,
  ConversationDetailDto,
  ConversationDto,
  CreateDirectBody,
  CreateGroupBody,
  ListConversationsQuery,
  MarkReadBody,
  MuteBody,
  UnreadCountDto,
} from '@taskflow/contracts/chat';
import { Uuid } from '@taskflow/contracts/common';
import { http, type HttpHandler } from 'msw';
import * as z from 'zod';

import type { Conversation, MockChat } from './mock-chat';
import type { MockDb } from './mock-db';
import { requireCompany } from './mock-guard';
import { fail, noContent, ok, paginate, parseBody, parseQuery } from './respond';

// Hội thoại của mock chat (avatar-chat.md §4, ADR-143/145/146). Thứ tự lỗi: 401 → 400 → 404 (không phải người tham
// gia — kể cả Admin/HR) → 403 (không phải OWNER) → 422 `BUSINESS_RULE_VIOLATION` + `details.rule`.

export const rule = (name: string) => fail(422, 'BUSINESS_RULE_VIOLATION', { rule: name });
const notFound = () => fail(404, 'RESOURCE_NOT_FOUND', { resource: 'conversation' });

type Loaded = { conv: Conversation; response?: never } | { response: Response; conv?: never };

/** Hội thoại người này ĐỌC được; id sai ⇒ 400; không thấy / không tham gia ⇒ 404 như nhau (ADR-146). */
export function loadConversation(chat: MockChat, userId: string, id: unknown): Loaded {
  if (!Uuid.safeParse(id).success) return { response: fail(400, 'VALIDATION_ERROR') };
  const conv = chat.conversations.get(String(id));
  return conv && chat.canRead(conv, userId) ? { conv } : { response: notFound() };
}

/** Người được thêm: id lạ ⇒ 404; không thuộc công ty hoạt động (rời / chờ kích hoạt) ⇒ 422. */
export const invitees = (db: MockDb, chat: MockChat) => (ids: readonly string[]) => {
  if (ids.some((id) => !db.getUser(id)))
    return fail(404, 'RESOURCE_NOT_FOUND', { resource: 'user' });
  return ids.some((id) => !chat.activeInCompany(id)) ? rule('NOT_ACTIVE_MEMBER') : null;
};

export function createChatHandlers(baseUrl: string, db: MockDb, chat: MockChat): HttpHandler[] {
  const url = (path: string) => `${baseUrl}/chat${path}`;
  const dto = (conv: Conversation, viewer: string) => chat.toDto(conv, viewer);

  const checkInvitees = invitees(db, chat);

  return [
    http.get(url('/conversations'), ({ request }) => {
      const ctx = requireCompany(request, db);
      if (ctx.response) return ctx.response;
      const q = parseQuery(request, ListConversationsQuery);
      if (q.response) return q.response;
      const me = ctx.ok.user.id;
      const page = paginate(chat.listFor(me), q.data.cursor, q.data.limit);
      return ok(
        z.array(ConversationDto),
        page.data.map((c) => dto(c, me)),
        { page: page.page },
      );
    }),

    http.get(url('/unread-count'), ({ request }) => {
      const ctx = requireCompany(request, db);
      if (ctx.response) return ctx.response;
      const me = ctx.ok.user.id;
      const total = chat
        .listFor(me)
        .map((c) => dto(c, me))
        .filter((c) => !c.muted)
        .reduce((sum, c) => sum + c.unread, 0);
      return ok(UnreadCountDto, { total });
    }),

    // Danh bạ (R49): người thuộc công ty hoạt động, không email, không người chờ kích hoạt / đã rời.
    http.get(url('/people'), ({ request }) => {
      const ctx = requireCompany(request, db);
      if (ctx.response) return ctx.response;
      const q = parseQuery(request, ChatPeopleQuery);
      if (q.response) return q.response;
      const needle = q.data.q.toLocaleLowerCase('vi');
      const people = db.company
        .members()
        .map(([id]) => id)
        .filter((id) => chat.activeInCompany(id))
        .map((id) => chat.userRef(id))
        .filter((p) => p.fullName.toLocaleLowerCase('vi').includes(needle))
        .sort((a, b) => a.fullName.localeCompare(b.fullName, 'vi'))
        .slice(0, 20);
      return ok(z.array(ChatPersonDto), people);
    }),

    http.post(url('/direct'), async ({ request }) => {
      const ctx = requireCompany(request, db);
      if (ctx.response) return ctx.response;
      const body = await parseBody(request, CreateDirectBody);
      if (body.response) return body.response;
      const me = ctx.ok.user.id;
      const other = body.data.userId;
      if (other === me) return rule('SELF_DIRECT');
      if (!chat.activeInCompany(other)) return rule('RECIPIENT_INACTIVE');
      const key = [me, other].sort().join(':');
      const existing = [...chat.conversations.values()].find((c) => c.directKey === key);
      if (existing) return ok(ConversationDto, dto(existing, me));
      const conv = chat.create('DIRECT', { directKey: key });
      chat.addParticipant(conv.id, me, 'MEMBER');
      chat.addParticipant(conv.id, other, 'MEMBER');
      return ok(ConversationDto, dto(conv, me), { status: 201 });
    }),

    http.post(url('/groups'), async ({ request }) => {
      const ctx = requireCompany(request, db);
      if (ctx.response) return ctx.response;
      const body = await parseBody(request, CreateGroupBody);
      if (body.response) return body.response;
      const me = ctx.ok.user.id;
      const others = body.data.memberIds.filter((id) => id !== me);
      if (others.length > CHAT_GROUP_MAX_OTHERS) return rule('GROUP_TOO_LARGE');
      const bad = checkInvitees(others);
      if (bad) return bad;
      const conv = chat.create('GROUP', { title: body.data.title });
      chat.addParticipant(conv.id, me, 'OWNER');
      others.forEach((id) => chat.addParticipant(conv.id, id, 'MEMBER'));
      return ok(ConversationDto, dto(conv, me), { status: 201 });
    }),

    // Phòng của workspace: tạo lười; thành viên = workspace_members hiện tại (ADR-143).
    http.put(`${baseUrl}/chat/workspaces/:wsId/conversation`, ({ request, params }) => {
      const ctx = requireCompany(request, db);
      if (ctx.response) return ctx.response;
      const wsId = String(params.wsId);
      if (!Uuid.safeParse(wsId).success) return fail(400, 'VALIDATION_ERROR');
      if (!db.workspaces.active(wsId) || !db.workspaces.member(wsId, ctx.ok.user.id)) {
        return fail(404, 'RESOURCE_NOT_FOUND', { resource: 'workspace' });
      }
      const conv =
        [...chat.conversations.values()].find((c) => c.workspaceId === wsId) ??
        chat.create('WORKSPACE', { workspaceId: wsId });
      return ok(ConversationDto, dto(conv, ctx.ok.user.id));
    }),

    http.get(url('/conversations/:id'), ({ request, params }) => {
      const ctx = requireCompany(request, db);
      if (ctx.response) return ctx.response;
      const loaded = loadConversation(chat, ctx.ok.user.id, params.id);
      if (loaded.response) return loaded.response;
      return ok(ConversationDetailDto, chat.toDetail(loaded.conv, ctx.ok.user.id));
    }),

    http.put(url('/conversations/:id/read'), async ({ request, params }) => {
      const ctx = requireCompany(request, db);
      if (ctx.response) return ctx.response;
      const loaded = loadConversation(chat, ctx.ok.user.id, params.id);
      if (loaded.response) return loaded.response;
      const body = await parseBody(request, MarkReadBody);
      if (body.response) return body.response;
      if (chat.messages.find(body.data.messageId)?.conversationId !== loaded.conv.id) {
        return fail(404, 'RESOURCE_NOT_FOUND', { resource: 'message' });
      }
      chat.markRead(loaded.conv.id, ctx.ok.user.id, body.data.messageId);
      return noContent();
    }),

    http.put(url('/conversations/:id/mute'), async ({ request, params }) => {
      const ctx = requireCompany(request, db);
      if (ctx.response) return ctx.response;
      const loaded = loadConversation(chat, ctx.ok.user.id, params.id);
      if (loaded.response) return loaded.response;
      const body = await parseBody(request, MuteBody);
      if (body.response) return body.response;
      chat.setMuted(loaded.conv.id, ctx.ok.user.id, body.data.muted);
      return noContent();
    }),
  ];
}
