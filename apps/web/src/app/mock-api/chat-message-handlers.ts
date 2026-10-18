import {
  CHAT_EDIT_WINDOW_SECONDS,
  DownloadUrlDto,
  EditMessageBody,
  ListMessagesQuery,
  MessageDto,
  SendMessageBody,
  UploadQuery,
  UploadResponseDto,
} from '@taskflow/contracts/chat';
import { CHAT_FILE_MAX_BYTES, CHAT_MAX_ATTACHMENTS, Uuid } from '@taskflow/contracts/common';
import { HttpResponse, http, type HttpHandler } from 'msw';
import * as z from 'zod';

import { loadConversation, rule } from './chat-handlers';
import type { MockChat } from './mock-chat';
import { imageSize } from './mock-chat-messages';
import type { MockDb } from './mock-db';
import { requireCompany } from './mock-guard';
import type { RateLimiter } from './request-guards';
import { fail, noContent, ok, parseBody, parseQuery } from './respond';
import { mediaGone, sniffFile, sniffImage, uploadName } from './upload-sniff';

// Tin nhắn + tệp của mock chat (avatar-chat.md §4, ADR-141/144). Hạn mức: gửi 30 / phút, upload 30 / 10 phút.

export function createChatMessageHandlers(
  baseUrl: string,
  db: MockDb,
  chat: MockChat,
  limit: RateLimiter,
): HttpHandler[] {
  const url = (path: string) => `${baseUrl}/chat${path}`;
  const msgs = chat.messages;
  const toDto = (m: Parameters<typeof msgs.toDto>[0]) => msgs.toDto(m, (id) => chat.userRef(id));
  /** Tin của chính mình, chưa xóa, ở hội thoại mình còn đọc được — khác ⇒ 404 (SEC-CH-16). */
  const ownMessage = (userId: string, id: unknown) => {
    const m = Uuid.safeParse(id).success ? msgs.find(String(id)) : undefined;
    const conv = m && chat.conversations.get(m.conversationId);
    return m && conv && !m.deletedAt && m.senderId === userId && chat.isMember(conv, userId)
      ? m
      : undefined;
  };

  return [
    http.get(url('/conversations/:id/messages'), ({ request, params }) => {
      const ctx = requireCompany(request, db);
      if (ctx.response) return ctx.response;
      const loaded = loadConversation(chat, ctx.ok.user.id, params.id);
      if (loaded.response) return loaded.response;
      const q = parseQuery(request, ListMessagesQuery);
      if (q.response) return q.response;
      const page = msgs.page(loaded.conv.id, q.data);
      return ok(z.array(MessageDto), page.data.map(toDto), {
        page: { nextCursor: null, hasMore: page.hasMore, limit: q.data.limit },
      });
    }),

    http.post(url('/conversations/:id/messages'), async ({ request, params }) => {
      const ctx = requireCompany(request, db);
      if (ctx.response) return ctx.response;
      const me = ctx.ok.user.id;
      const loaded = loadConversation(chat, me, params.id);
      if (loaded.response) return loaded.response;
      const body = await parseBody(request, SendMessageBody);
      if (body.response) return body.response;
      const { clientMsgId, replyToId, attachmentIds } = body.data;
      const text = body.data.body ?? '';
      const hash = [loaded.conv.id, text, [...attachmentIds].sort().join(',')].join('|');
      const previous = msgs.findByClient(me, clientMsgId);
      if (previous) {
        // Trùng clientMsgId: giống hệt ⇒ trả tin cũ 200, không event; khác ⇒ 422 (ADR-144, F-03a).
        return previous.requestHash === hash
          ? ok(MessageDto, toDto(previous))
          : rule('IDEMPOTENCY_KEY_REUSED');
      }
      if (!chat.toDto(loaded.conv, me).canSend) return rule('RECIPIENT_INACTIVE');
      if (attachmentIds.length > CHAT_MAX_ATTACHMENTS) return rule('TOO_MANY_ATTACHMENTS');
      const foreign = attachmentIds.some((id) => {
        const u = msgs.uploads.get(id);
        return !u || u.uploaderId !== me || u.messageId !== null;
      });
      if (foreign) return fail(404, 'RESOURCE_NOT_FOUND', { resource: 'upload' });
      if (replyToId && msgs.find(replyToId)?.conversationId !== loaded.conv.id) {
        return rule('REPLY_OTHER_CONVERSATION');
      }
      const limited = limit(`chat-send:${me}`, 30, 60_000);
      if (limited) return limited;
      const message = msgs.add({
        conversationId: loaded.conv.id,
        senderId: me,
        clientMsgId,
        requestHash: hash,
        body: text.length > 0 ? text : null,
        replyToId: replyToId ?? null,
        attachmentIds,
      });
      chat.markRead(loaded.conv.id, me, message.id); // tin của mình không tính chưa đọc
      return ok(MessageDto, toDto(message), { status: 201 });
    }),

    http.patch(url('/messages/:id'), async ({ request, params }) => {
      const ctx = requireCompany(request, db);
      if (ctx.response) return ctx.response;
      const message = ownMessage(ctx.ok.user.id, params.id);
      if (!message) return fail(404, 'RESOURCE_NOT_FOUND', { resource: 'message' });
      const body = await parseBody(request, EditMessageBody);
      if (body.response) return body.response;
      if (chat.now() - Date.parse(message.createdAt) > CHAT_EDIT_WINDOW_SECONDS * 1000) {
        return rule('EDIT_WINDOW_PASSED');
      }
      message.body = body.data.body;
      message.editedAt = chat.iso();
      return ok(MessageDto, toDto(message));
    }),

    http.delete(url('/messages/:id'), ({ request, params }) => {
      const ctx = requireCompany(request, db);
      if (ctx.response) return ctx.response;
      const message = ownMessage(ctx.ok.user.id, params.id);
      if (!message) return fail(404, 'RESOURCE_NOT_FOUND', { resource: 'message' });
      msgs.remove(message);
      return noContent();
    }),

    http.post(url('/uploads'), async ({ request }) => {
      const ctx = requireCompany(request, db);
      if (ctx.response) return ctx.response;
      const q = parseQuery(request, UploadQuery);
      if (q.response) return q.response;
      const name = uploadName(request);
      if (!name) return fail(400, 'INVALID_UPLOAD_NAME');
      if (Number(request.headers.get('content-length') ?? 0) > CHAT_FILE_MAX_BYTES) {
        return fail(413, 'PAYLOAD_TOO_LARGE');
      }
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (bytes.length > CHAT_FILE_MAX_BYTES) return fail(413, 'PAYLOAD_TOO_LARGE');
      const asImage = q.data.as === 'image';
      const imageMime = asImage ? sniffImage(bytes, true) : null;
      const file = asImage ? null : sniffFile(bytes, name);
      if (asImage && !imageMime) return fail(415, 'UNSUPPORTED_FILE_TYPE');
      if (file && 'reject' in file) {
        return file.reject === 'macro'
          ? fail(415, 'MACRO_OR_ACTIVE_CONTENT')
          : fail(415, 'UNSUPPORTED_FILE_TYPE');
      }
      const limited = limit(`chat-upload:${ctx.ok.user.id}`, 30, 600_000);
      if (limited) return limited;
      const size = asImage ? imageSize(bytes) : null;
      const upload = {
        id: crypto.randomUUID(),
        uploaderId: ctx.ok.user.id,
        kind: asImage ? ('IMAGE' as const) : ('FILE' as const),
        name,
        mime: imageMime ?? (file && 'mime' in file ? file.mime : 'application/octet-stream'),
        bytes,
        width: size?.width ?? null,
        height: size?.height ?? null,
        messageId: null,
        createdAt: chat.iso(),
      };
      msgs.uploads.set(upload.id, upload);
      const { id: uploadId, kind, width, height } = upload;
      return ok(
        UploadResponseDto,
        { uploadId, kind, name, sizeBytes: bytes.length, width, height },
        { status: 201 },
      );
    }),

    // Tệp không phải ảnh: URL tải 60 s, kiểm quyền LÚC BẤM (ADR-141); web `location.assign(url)` ngay.
    http.post(url('/attachments/:id/download-url'), ({ request, params }) => {
      const ctx = requireCompany(request, db);
      if (ctx.response) return ctx.response;
      const upload = msgs.uploads.get(String(params.id));
      const message = upload?.messageId ? msgs.find(upload.messageId) : undefined;
      const conv = message && chat.conversations.get(message.conversationId);
      // Ảnh đã có previewUrl / thumbUrl ký sẵn ⇒ download-url chỉ cho FILE, ảnh ⇒ 404 (server T-069, G 18/10).
      if (!upload || upload.kind === 'IMAGE' || !conv || !chat.canRead(conv, ctx.ok.user.id)) {
        return fail(404, 'RESOURCE_NOT_FOUND', { resource: 'attachment' });
      }
      const exp = Math.floor(chat.now() / 1000) + 60;
      return ok(DownloadUrlDto, {
        url: `${baseUrl}/media/chat/${upload.id}/file?purpose=download&exp=${exp}&sig=mock`,
      });
    }),

    // Không Bearer: "chữ ký" + kiểm DB mỗi lần — tệp còn gắn tin chưa xóa, chưa hết hạn (ADR-141 B M4, SEC-CH-22).
    http.get(`${baseUrl}/media/chat/:id/:variant`, ({ request, params }) => {
      const query = new URL(request.url).searchParams;
      const upload = msgs.uploads.get(String(params.id));
      const attached = upload?.messageId && !msgs.find(upload.messageId)?.deletedAt;
      if (
        query.get('sig') !== 'mock' ||
        Number(query.get('exp')) * 1000 < chat.now() ||
        !upload ||
        !attached
      ) {
        return mediaGone();
      }
      const download = String(params.variant) === 'file';
      const ascii = upload.name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
      return new HttpResponse(upload.bytes.slice().buffer, {
        headers: {
          'Content-Type': download ? 'application/octet-stream' : upload.mime,
          'Content-Disposition': download
            ? `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(upload.name)}`
            : 'inline',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; sandbox",
          'Cache-Control': download ? 'no-store' : 'private, max-age=3600',
        },
      });
    }),
  ];
}
