import type { Tone } from '../lib/calendar';

/**
 * Màu theo loại ngày (T-046) — CHỈ là lớp phụ: chữ luôn `text-text` (tương phản AA ở cả sáng/tối), màu nằm ở viền trái +
 * nền nhạt + biểu tượng. Trạng thái luôn có chữ + biểu tượng (không chỉ màu — WCAG 1.4.1).
 */
export const TONE: Readonly<Record<Tone, { cell: string; icon: string; legend: string | null }>> = {
  work: { cell: 'border-l-success bg-success/10', icon: 'text-success', legend: 'Đi làm' },
  late: {
    cell: 'border-l-warning bg-warning/10',
    icon: 'text-warning',
    legend: 'Đi muộn / về sớm / quên chấm ra',
  },
  absent: { cell: 'border-l-danger bg-danger/10', icon: 'text-danger', legend: 'Vắng' },
  leave: { cell: 'border-l-primary bg-primary/10', icon: 'text-primary', legend: 'Nghỉ phép' },
  holiday: { cell: 'border-l-primary bg-primary/5', icon: 'text-primary', legend: 'Ngày lễ' },
  off: {
    cell: 'border-l-border bg-bg-subtle',
    icon: 'text-text-muted',
    legend: 'Chủ nhật / ngày nghỉ',
  },
  muted: { cell: 'border-l-border', icon: 'text-text-muted', legend: 'Hôm nay chưa chấm' },
  none: { cell: 'border-l-transparent', icon: '', legend: null },
};

export const TONE_ICON: Readonly<Record<Tone, string>> = {
  work: '✓',
  late: '!',
  absent: '✕',
  leave: '☾',
  holiday: '★',
  off: '–',
  muted: '○',
  none: '',
};
