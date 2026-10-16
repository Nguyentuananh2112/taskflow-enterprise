/** Thứ tự bit của `workdays` (A): bit 0 = thứ Hai … bit 6 = Chủ nhật. */
export const WEEKDAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'] as const;

/** 0b0111111 ⇒ "T2, T3, T4, T5, T6, T7". */
export function workdaysText(mask: number): string {
  return WEEKDAYS.filter((_, bit) => (mask & (1 << bit)) !== 0).join(', ');
}
