import { Accessibility } from '@dnd-kit/dom';
import type { DragDropManagerInput } from '@dnd-kit/dom';
import type { TaskStatus } from '@taskflow/contracts/task';

import { STATUS_LABEL } from '@/entities/task';

// Thông báo cho trình đọc màn hình bằng tiếng Việt (frontend.md §4.2, WCAG 2.2). Dữ liệu thẻ đi kèm
// sortable qua `data` (key + cột) nên không cần tra cứu ngoài.

export type CardData = Readonly<{ status: TaskStatus; key: string }>;

const card = (data: unknown): CardData | null =>
  typeof data === 'object' && data !== null && 'key' in data && 'status' in data
    ? (data as CardData)
    : null;

const where = (status: TaskStatus | undefined) => (status ? `cột ${STATUS_LABEL[status]}` : '');

export const SCREEN_READER_INSTRUCTIONS =
  'Nhấn Space để nhấc thẻ, phím mũi tên để di chuyển, Space để thả, Escape để hủy.';

const announcements = {
  dragstart: ({ operation: { source } }: { operation: { source: { data?: unknown } | null } }) => {
    const c = card(source?.data);
    return c ? `Đã nhấc ${c.key} ở ${where(c.status)}.` : undefined;
  },
  dragover: ({
    operation: { source, target },
  }: {
    operation: { source: { data?: unknown } | null; target: { data?: unknown } | null };
  }) => {
    const c = card(source?.data);
    const to = (target?.data as { status?: TaskStatus } | undefined)?.status;
    return c && to ? `${c.key} đang ở ${where(to)}.` : undefined;
  },
  dragend: ({
    operation: { source, target },
    canceled,
  }: {
    operation: { source: { data?: unknown } | null; target: { data?: unknown } | null };
    canceled: boolean;
  }) => {
    const c = card(source?.data);
    if (!c) return undefined;
    if (canceled) return `Đã hủy kéo ${c.key}.`;
    const to = (target?.data as { status?: TaskStatus } | undefined)?.status;
    return `Đã thả ${c.key}${to ? ` vào ${where(to)}` : ''}.`;
  },
};

/** Plugin mặc định + Accessibility cấu hình tiếng Việt (descriptor sau ghi đè tùy chọn mặc định). */
export const boardPlugins: NonNullable<DragDropManagerInput['plugins']> = (defaults) => [
  ...defaults,
  Accessibility.configure({
    announcements,
    screenReaderInstructions: { draggable: SCREEN_READER_INSTRUCTIONS },
  }),
];
