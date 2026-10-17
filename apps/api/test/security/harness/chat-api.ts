import { randomUUID } from 'node:crypto';

import { expect } from 'vitest';

import type { CompanyActor, CompanyActors } from './company';
import { errorEnvelope, type RawResponse } from './http-client';

/**
 * Route trò chuyện (avatar-chat.md §4, contract `@taskflow/contracts/chat` — G 265d08c4) cho suite hộp đen. Ca không
 * lặp chuỗi đường dẫn; route đổi ⇒ chỉ sửa ở đây.
 */
export const CHAT = {
  people: (q: string) => `/chat/people?q=${encodeURIComponent(q)}`,
  conversations: '/chat/conversations?limit=50',
  unread: '/chat/unread-count',
  direct: '/chat/direct',
  groups: '/chat/groups',
  wsRoom: (wsId: string) => `/chat/workspaces/${wsId}/conversation`,
  conversation: (id: string) => `/chat/conversations/${id}`,
  members: (id: string) => `/chat/conversations/${id}/members`,
  member: (id: string, userId: string) => `/chat/conversations/${id}/members/${userId}`,
  owner: (id: string) => `/chat/conversations/${id}/owner`,
  leave: (id: string) => `/chat/conversations/${id}/leave`,
  messages: (id: string, q = '') => `/chat/conversations/${id}/messages${q}`,
  read: (id: string) => `/chat/conversations/${id}/read`,
  mute: (id: string) => `/chat/conversations/${id}/mute`,
  message: (id: string) => `/chat/messages/${id}`,
  downloadUrl: (attachmentId: string) => `/chat/attachments/${attachmentId}/download-url`,
} as const;

export interface ConversationDto {
  id: string;
  kind: 'DIRECT' | 'GROUP' | 'WORKSPACE';
  title: string | null;
  workspaceId: string | null;
  peer: { id: string; fullName: string } | null;
  memberCount: number;
  unread: number;
  muted: boolean;
  canSend: boolean;
  myRole: 'OWNER' | 'MEMBER' | null;
}
export interface MessageDto {
  id: string;
  conversationId: string;
  sender: { id: string; fullName: string };
  clientMsgId: string;
  body: string | null;
  attachments: { id: string }[];
  editedAt: string | null;
  deletedAt: string | null;
}

export const dataOf = <T>(res: RawResponse): T => (res.json as { data: T }).data;
export const errorOf = (res: RawResponse) => errorEnvelope(res).error;
export const ruleOf = (res: RawResponse) =>
  (errorOf(res).details as { rule?: string } | null)?.rule;

export function expectStatus(res: RawResponse, status: number, what: string): void {
  expect(res.status, `${what}: ${res.text.slice(0, 300)}`).toBe(status);
}

type Who = Pick<CompanyActor, 'accessToken'>;

export class ChatClient {
  constructor(private readonly actors: CompanyActors) {}

  call(who: Who | undefined, method: string, path: string, body?: unknown): Promise<RawResponse> {
    return this.actors.json(method, path, who?.accessToken, body);
  }

  /** `POST chat/direct` (tạo-hoặc-lấy) ⇒ 201 lần đầu / 200 lần sau. */
  async direct(a: Who, bUserId: string): Promise<ConversationDto> {
    const res = await this.call(a, 'POST', CHAT.direct, { userId: bUserId });
    expect([200, 201], `POST chat/direct: ${res.text.slice(0, 300)}`).toContain(res.status);
    return dataOf<ConversationDto>(res);
  }

  async group(owner: Who, title: string, memberIds: string[]): Promise<ConversationDto> {
    const res = await this.call(owner, 'POST', CHAT.groups, { title, memberIds });
    expectStatus(res, 201, `POST chat/groups ${title}`);
    return dataOf<ConversationDto>(res);
  }

  async wsRoom(member: Who, wsId: string): Promise<ConversationDto> {
    const res = await this.call(member, 'PUT', CHAT.wsRoom(wsId), {});
    expect([200, 201], `PUT ws room: ${res.text.slice(0, 300)}`).toContain(res.status);
    return dataOf<ConversationDto>(res);
  }

  sendRaw(who: Who, convId: string, body: Record<string, unknown>): Promise<RawResponse> {
    return this.call(who, 'POST', CHAT.messages(convId), { clientMsgId: randomUUID(), ...body });
  }

  async send(who: Who, convId: string, text: string): Promise<MessageDto> {
    const res = await this.sendRaw(who, convId, { body: text });
    expectStatus(res, 201, `gửi tin vào ${convId}`);
    return dataOf<MessageDto>(res);
  }

  async messages(who: Who, convId: string): Promise<MessageDto[]> {
    const res = await this.call(who, 'GET', CHAT.messages(convId, '?limit=200'));
    expectStatus(res, 200, `GET messages ${convId}`);
    return dataOf<MessageDto[]>(res);
  }

  async conversationIds(who: Who): Promise<string[]> {
    const res = await this.call(who, 'GET', CHAT.conversations);
    expectStatus(res, 200, 'GET chat/conversations');
    return dataOf<ConversationDto[]>(res).map((c) => c.id);
  }
}

/** Body 404 "không phải người tham gia" phải GIỐNG HỆT id ngẫu nhiên (không lộ tồn tại — ADR-146). */
export function sameNotFound(a: RawResponse, b: RawResponse, what: string): void {
  expectStatus(a, 404, what);
  expectStatus(b, 404, `${what} (id ngẫu nhiên)`);
  const strip = (r: RawResponse) => {
    const e = errorOf(r);
    return { code: e.code, message: e.message, details: e.details };
  };
  expect(strip(a), `${what}: 404 khác id ngẫu nhiên`).toEqual(strip(b));
}
