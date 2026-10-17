import { createHash } from 'node:crypto';

import { BusinessRuleViolationError, ForbiddenError } from '../../../core/errors';

// Luật tin nhắn THUẦN (avatar-chat.md ADR-144/145; T-069a). Cửa sổ sửa truyền vào (G: không đọc env trong domain).

/** = `CHAT_MAX_ATTACHMENTS` của contracts (≤ 10 tệp / tin; 11 ⇒ 422). */
export const MAX_ATTACHMENTS = 10;
/** = `CHAT_UNREAD_CAP`. */
export const UNREAD_CAP = 99;
/** Độ dài xem trước (danh sách hội thoại, trả lời). */
export const PREVIEW_CODE_POINTS = 120;

/**
 * `request_hash` (§3): SHA-256 hex của (hội thoại, thân đã chuẩn hóa, attachmentIds sắp xếp) — phân biệt gửi lại
 * GIỐNG (trả tin cũ) với dùng lại `clientMsgId` cho nội dung KHÁC (422). Mã hóa độ dài từng phần ⇒ không có hai bộ
 * khác nhau ra cùng chuỗi trước khi băm.
 */
export function requestHash(input: {
  conversationId: string;
  body: string | null;
  attachmentIds: readonly string[];
}): string {
  const ids = input.attachmentIds.map((id) => id.toLowerCase()).sort();
  const parts = [input.conversationId.toLowerCase(), input.body ?? '', ...ids];
  const framed = parts.map((p) => `${String(p.length)}:${p}`).join('|');
  return createHash('sha256')
    .update(`v1|${String(ids.length)}|${framed}`, 'utf8')
    .digest('hex');
}

/** Trùng `(sender, clientMsgId)`: cùng hash ⇒ trả tin cũ (không phát event lần hai); khác ⇒ 422 IDEMPOTENCY_KEY_REUSED. */
export function assertSameRequest(existingHash: string, incomingHash: string): void {
  if (existingHash !== incomingHash) {
    throw new BusinessRuleViolationError(
      'IDEMPOTENCY_KEY_REUSED',
      'Mã tin nhắn đã được dùng cho một tin khác.',
    );
  }
}

/** Store chat: đính kèm không còn gắn được (mất giữa claim và gắn — B M1) ⇒ 422, rollback cả tin. */
export function attachmentUnavailable(): BusinessRuleViolationError {
  return new BusinessRuleViolationError(
    'ATTACHMENT_UNAVAILABLE',
    'Có tệp đính kèm không còn dùng được — hãy tải lên lại.',
  );
}

export function assertAttachmentCount(n: number): void {
  if (n > MAX_ATTACHMENTS) {
    throw new BusinessRuleViolationError('TOO_MANY_ATTACHMENTS', 'Tối đa 10 tệp mỗi tin.', {
      max: MAX_ATTACHMENTS,
    });
  }
}

/** Trả lời: tin gốc phải cùng hội thoại (khác ⇒ 422). Tin gốc đã xóa vẫn trả lời được (hiện "tin đã xóa"). */
export function assertReplyInConversation(
  replyConversationId: string,
  conversationId: string,
): void {
  if (replyConversationId !== conversationId) {
    throw new BusinessRuleViolationError(
      'REPLY_OTHER_CONVERSATION',
      'Chỉ trả lời tin trong cùng cuộc trò chuyện.',
    );
  }
}

interface OwnMessageView {
  readonly senderId: string;
  readonly createdAt: Date;
  readonly deletedAt: Date | null;
}

/**
 * Sửa (ADR-144): chỉ người gửi (khác ⇒ 403), tin chưa xóa, trong `windowSeconds` kể từ `created_at` (biên ĐÚNG
 * bằng cửa sổ vẫn sửa được; quá ⇒ 422 EDIT_WINDOW_PASSED). Tin đã xóa ⇒ cùng lỗi quá hạn — không còn gì để sửa.
 */
export function assertCanEdit(
  message: OwnMessageView,
  actorId: string,
  now: Date,
  windowSeconds: number,
): void {
  assertSender(message, actorId);
  const ageMs = now.getTime() - message.createdAt.getTime();
  if (message.deletedAt !== null || ageMs > windowSeconds * 1000) {
    throw new BusinessRuleViolationError('EDIT_WINDOW_PASSED', 'Đã quá thời gian được sửa tin.', {
      windowSeconds,
    });
  }
}

/** Xóa: chỉ người gửi (không ai khác — TL chốt). Xóa lại tin đã xóa ⇒ `false` (idempotent, không ghi). */
export function canDelete(message: OwnMessageView, actorId: string): boolean {
  assertSender(message, actorId);
  return message.deletedAt === null;
}

function assertSender(message: OwnMessageView, actorId: string): void {
  if (message.senderId !== actorId) throw new ForbiddenError('chat:own-message');
}

/** ≤ 120 code point đầu, gộp xuống dòng thành khoảng trắng; rỗng / đã xóa ⇒ null. */
export function bodyPreview(body: string | null): string | null {
  if (body === null) return null;
  const flat = body.replace(/\s+/g, ' ').trim();
  if (flat === '') return null;
  const cps = [...flat];
  return cps.length <= PREVIEW_CODE_POINTS
    ? flat
    : `${cps.slice(0, PREVIEW_CODE_POINTS).join('')}…`;
}

export interface KeysetPoint {
  readonly createdAt: Date;
  readonly id: string;
}

/** Thứ tự tin `(created_at, id)` — âm ⇔ `a` trước `b`. Dùng cho con trỏ đã đọc chỉ tiến và in-memory repo. */
export function compareKeyset(a: KeysetPoint, b: KeysetPoint): number {
  const t = a.createdAt.getTime() - b.createdAt.getTime();
  if (t !== 0) return t;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export const capUnread = (n: number): number => Math.min(UNREAD_CAP, Math.max(0, n));
