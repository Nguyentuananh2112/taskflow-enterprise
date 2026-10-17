import type { MessageDto } from '@taskflow/contracts/chat';
import type { InfiniteData } from '@tanstack/react-query';

// Cache luồng tin (avatar-chat.md §7 E6/E8) — hàm THUẦN để test được. `pages[0]` = trang MỚI NHẤT; mỗi trang cũ → mới;
// trang sau là trang cũ hơn (`before`). Gộp theo `id`; tin lạc quan khớp theo `clientMsgId` ⇒ echo realtime đến TRƯỚC
// response vẫn không trùng; catch-up `after` gộp theo `id`.

export type MessagePage = { data: MessageDto[]; page: { hasMore: boolean } | undefined };
export type MessagesData = InfiniteData<MessagePage>;

/** Tin theo thứ tự hiển thị (cũ → mới). */
export function flatten(data: MessagesData | undefined): MessageDto[] {
  return data ? [...data.pages].reverse().flatMap((p) => p.data) : [];
}

const sameMessage = (a: MessageDto, b: MessageDto) =>
  a.id === b.id || (a.clientMsgId === b.clientMsgId && a.sender.id === b.sender.id);

/** Thêm hoặc thay (cùng id, hoặc cùng clientMsgId của cùng người gửi — bản lạc quan). Chưa có cache ⇒ để nguyên. */
export function upsertMessage(
  data: MessagesData | undefined,
  message: MessageDto,
): MessagesData | undefined {
  if (!data) return data;
  let replaced = false;
  const pages = data.pages.map((p) => ({
    ...p,
    data: p.data.map((m) => {
      if (!sameMessage(m, message)) return m;
      replaced = true;
      return message;
    }),
  }));
  if (!replaced) {
    const [newest, ...rest] = pages;
    const first = newest ?? { data: [], page: undefined };
    return { ...data, pages: [{ ...first, data: [...first.data, message] }, ...rest] };
  }
  return { ...data, pages };
}

/** Bù khi nối lại (`after`): gộp theo id, giữ thứ tự (createdAt, id). */
export function appendMessages(
  data: MessagesData | undefined,
  messages: readonly MessageDto[],
): MessagesData | undefined {
  return messages.reduce<MessagesData | undefined>((acc, m) => upsertMessage(acc, m), data);
}

/** Bỏ bản lạc quan (gửi thất bại và người dùng bỏ). */
export function dropMessage(data: MessagesData | undefined, id: string): MessagesData | undefined {
  if (!data) return data;
  return {
    ...data,
    pages: data.pages.map((p) => ({ ...p, data: p.data.filter((m) => m.id !== id) })),
  };
}

export const newestMessage = (data: MessagesData | undefined): MessageDto | undefined =>
  flatten(data).at(-1);
