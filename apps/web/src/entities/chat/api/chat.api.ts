import type { SendMessageBody } from '@taskflow/contracts/chat';
import {
  ChatPersonDto,
  ConversationDetailDto,
  ConversationDto,
  DownloadUrlDto,
  MessageDto,
  UnreadCountDto,
  UploadResponseDto,
  type CreateGroupBody,
} from '@taskflow/contracts/chat';
import * as z from 'zod';

import { http, type UploadProgress } from '@/shared/api';

// Gọi `/chat/*` (avatar-chat.md §4). Response parse bằng schema contracts trong `http`.

const NoContent = z.undefined();

/** Body gửi tin (`attachmentIds` mặc định [] ở schema). */
export type SendInput = z.input<typeof SendMessageBody>;
const c = (id: string) => `/chat/conversations/${id}`;

/** Tệp lớn (≤ 20 MB) trên mạng chậm: refresh trước nếu token còn < 60 s (TL chốt). */
const UPLOAD_MIN_TOKEN_MS = 60_000;

export type UploadInput = Readonly<{
  file: Blob;
  name: string;
  as: 'image' | 'file';
  onProgress?: UploadProgress;
  signal?: AbortSignal;
}>;

export const chatApi = {
  conversations: (cursor: string | undefined) =>
    http.request('GET', '/chat/conversations', {
      schema: z.array(ConversationDto),
      query: { cursor, limit: 30 },
    }),
  unreadCount: () => http.get('/chat/unread-count', { schema: UnreadCountDto }),
  people: (q: string) => http.get('/chat/people', { schema: z.array(ChatPersonDto), query: { q } }),
  direct: (userId: string) =>
    http.post('/chat/direct', { schema: ConversationDto, body: { userId } }),
  group: (body: CreateGroupBody) => http.post('/chat/groups', { schema: ConversationDto, body }),
  workspaceRoom: (wsId: string) =>
    http.put(`/chat/workspaces/${wsId}/conversation`, { schema: ConversationDto }),
  detail: (id: string) => http.get(c(id), { schema: ConversationDetailDto }),
  rename: (id: string, title: string) =>
    http.patch(c(id), { schema: ConversationDto, body: { title } }),
  addMembers: (id: string, userIds: string[]) =>
    http.post(`${c(id)}/members`, { schema: ConversationDetailDto, body: { userIds } }),
  removeMember: (id: string, userId: string) =>
    http.delete(`${c(id)}/members/${userId}`, { schema: NoContent }),
  transferOwner: (id: string, userId: string) =>
    http.put(`${c(id)}/owner`, { schema: ConversationDetailDto, body: { userId } }),
  leave: (id: string) => http.post(`${c(id)}/leave`, { schema: NoContent }),
  /** Keyset: `before` ⇒ trang cũ hơn (≤ 50); `after` ⇒ bù khi nối lại (≤ 200). Thứ tự cũ → mới. */
  messages: (id: string, page: { before?: string; after?: string }) =>
    http.request('GET', `${c(id)}/messages`, {
      schema: z.array(MessageDto),
      query: { before: page.before, after: page.after, limit: page.after ? 200 : 50 },
    }),
  send: (id: string, body: SendInput) =>
    http.post(`${c(id)}/messages`, { schema: MessageDto, body }),
  edit: (messageId: string, body: string) =>
    http.patch(`/chat/messages/${messageId}`, { schema: MessageDto, body: { body } }),
  remove: (messageId: string) => http.delete(`/chat/messages/${messageId}`, { schema: NoContent }),
  markRead: (id: string, messageId: string) =>
    http.put(`${c(id)}/read`, { schema: NoContent, body: { messageId } }),
  mute: (id: string, muted: boolean) =>
    http.put(`${c(id)}/mute`, { schema: NoContent, body: { muted } }),
  upload: ({ file, name, as, onProgress, signal }: UploadInput) =>
    http.upload('POST', '/chat/uploads', {
      schema: UploadResponseDto,
      body: file,
      name,
      query: { as },
      minTokenValidityMs: UPLOAD_MIN_TOKEN_MS,
      ...(onProgress ? { onProgress } : {}),
      ...(signal ? { signal } : {}),
    }),
  /** Tệp không phải ảnh: URL 60 s, kiểm quyền lúc bấm (ADR-141). */
  downloadUrl: (attachmentId: string) =>
    http.post(`/chat/attachments/${attachmentId}/download-url`, { schema: DownloadUrlDto }),
};
