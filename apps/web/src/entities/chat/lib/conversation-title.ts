import type { ConversationDto } from '@taskflow/contracts/chat';

/** Tên hiện của hội thoại: DIRECT ⇒ người kia; nhóm ⇒ tên nhóm; phòng ws ⇒ "# tên workspace" (§7). */
export function conversationTitle(c: Pick<ConversationDto, 'kind' | 'title' | 'peer'>): string {
  if (c.kind === 'DIRECT') return c.peer?.fullName ?? 'Người dùng';
  if (c.kind === 'WORKSPACE') return `# ${c.title ?? 'Workspace'}`;
  return c.title ?? 'Nhóm';
}

/** Dòng phụ: số người / trạng thái người kia. */
export function conversationSubtitle(
  c: Pick<ConversationDto, 'kind' | 'memberCount' | 'canSend'>,
): string {
  if (c.kind === 'DIRECT')
    return c.canSend ? 'Tin nhắn riêng' : 'Không còn ở công ty — chỉ xem tin cũ';
  return `${c.memberCount} người`;
}
