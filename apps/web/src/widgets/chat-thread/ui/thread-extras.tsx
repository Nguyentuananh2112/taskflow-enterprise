'use client';

import type { ConversationDetailDto, MessageDto } from '@taskflow/contracts/chat';

import { useTypingUsers } from '@/features/chat-realtime';

/** Tên người theo id (thành viên nhóm / phòng ws, hoặc người kia ở DIRECT). */
export function nameOf(detail: ConversationDetailDto, userId: string): string {
  return (
    detail.members.find((m) => m.user.id === userId)?.user.fullName ??
    (detail.peer?.id === userId ? detail.peer.fullName : 'Ai đó')
  );
}

/** "Vic đang gõ…" (≤ 5 s sau lần cuối — ADR-145). Không đọc to (tránh ồn cho trình đọc màn hình). */
export function TypingLine({ detail }: Readonly<{ detail: ConversationDetailDto }>) {
  const typing = useTypingUsers(detail.id);
  if (typing.length === 0) return null;
  const names = typing.map((id) => nameOf(detail, id));
  const text = names.length === 1 ? `${names[0]} đang gõ…` : `${names.length} người đang gõ…`;
  return (
    <p aria-hidden="true" className="px-4 pb-1 text-xs text-text-muted">
      {text}
    </p>
  );
}

const spoken = (m: MessageDto) =>
  m.body
    ? `${m.sender.fullName}: ${m.body}`
    : `${m.sender.fullName} gửi ${m.attachments.length} tệp`;

/**
 * Vùng sr-only `aria-live="polite"` RIÊNG (§7 a11y, E8): chỉ đọc tin ĐẾN sau lúc mở ("Vic: …"); không đọc lịch sử, không
 * đọc tin của chính mình. `newestIncoming` = tin mới nhất của người khác có createdAt > lúc mở.
 */
export function LiveRegion({
  newestIncoming,
}: Readonly<{ newestIncoming: MessageDto | undefined }>) {
  return (
    <div aria-live="polite" aria-atomic="true" className="sr-only">
      {newestIncoming ? spoken(newestIncoming) : ''}
    </div>
  );
}
