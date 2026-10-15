import type { AuditLogDto } from '@taskflow/contracts/audit';

// Câu mô tả một dòng lịch sử theo hình dạng oldValue/newValue (data-and-api §1.5).

const STATUS: Readonly<Record<string, string>> = {
  TODO: 'Cần làm',
  IN_PROGRESS: 'Đang làm',
  REVIEW: 'Kiểm duyệt',
  DONE: 'Hoàn thành',
};
const FIELD: Readonly<Record<string, string>> = {
  title: 'tiêu đề',
  description: 'mô tả',
  priority: 'mức ưu tiên',
  dueDate: 'hạn chót',
};

const statusOf = (value: Record<string, unknown> | null) => {
  const status = value?.status;
  return typeof status === 'string' ? (STATUS[status] ?? status) : '?';
};

export function describeAudit(entry: AuditLogDto): string {
  switch (entry.action) {
    case 'CREATED':
      return 'tạo task';
    case 'STATUS_CHANGED':
      return `đổi trạng thái ${statusOf(entry.oldValue)} → ${statusOf(entry.newValue)}`;
    case 'MOVED':
      return 'đổi vị trí trong cột';
    case 'ASSIGNEE_CHANGED':
      return entry.newValue?.assigneeId ? 'đổi người phụ trách' : 'bỏ giao người phụ trách';
    case 'DELETED':
      return 'xóa task';
    case 'UPDATED': {
      const fields = Object.keys(entry.newValue ?? {}).map((k) => FIELD[k] ?? k);
      return fields.length > 0 ? `sửa ${fields.join(', ')}` : 'sửa task';
    }
  }
}

const UNITS: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

/** "2 phút trước" (Intl.RelativeTimeFormat 'vi' — frontend.md §6.2). */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const diff = Date.parse(iso) - now;
  const format = new Intl.RelativeTimeFormat('vi', { numeric: 'auto' });
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms) return format.format(Math.round(diff / ms), unit);
  }
  return format.format(0, 'second');
}
