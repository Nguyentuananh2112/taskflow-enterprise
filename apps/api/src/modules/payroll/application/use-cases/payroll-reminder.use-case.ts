import { todayOf, type PayrollDeps } from '../payroll-kit';

/** Nhắc từ ngày này của tháng (giờ lịch công ty) — ngày trả lương là mùng 10 (payroll.md §0). */
export const REMINDER_FROM_DAY = 5;

const prevMonth = (month: string) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return m === 1 ? `${String(y - 1)}-12` : `${String(y)}-${String(m - 1).padStart(2, '0')}`;
};

/**
 * `refId` của nhắc ngày `date` (YYYY-MM-DD): UUID tất định chỉ gồm chữ số của ngày — cùng ngày luôn cùng id ⇒ chống lặp
 * theo (kỳ, ngày) (kỳ suy từ ngày). Không trỏ tới bản ghi nào (web mở `/payroll`).
 */
export function reminderRefId(date: string): string {
  const [y, m, d] = date.split('-') as [string, string, string];
  return `0000${y}-${m}${d}-7000-8000-000000000001`;
}

/**
 * Job nhắc làm lương (payroll.md §4 bước 5, T-049): từ ngày 5 mỗi ngày — kể cả quá ngày 10 — tới khi bảng tháng trước
 * PUBLISHED (chưa tạo nháp cũng nhắc), tới mọi người đang có `payroll:manage`. Khóa advisory + `notifyOnce` theo `refId`
 * của ngày ⇒ nhiều instance / chạy nhiều lần trong ngày vẫn một nhắc. Trả `true` nếu đã gửi.
 */
export class PayrollReminderUseCase {
  constructor(private readonly d: PayrollDeps) {}

  async run(): Promise<boolean> {
    const { d } = this;
    const today = await todayOf(d);
    if (Number(today.slice(8)) < REMINDER_FROM_DAY) return false;
    const period = prevMonth(today.slice(0, 7));
    return d.uow.run(async () => {
      await d.store.lockPeriod(`reminder:${period}`);
      if ((await d.store.findRun(period))?.status === 'PUBLISHED') return false;
      return d.notifier.notifyOnce({
        type: 'PAYROLL_REMINDER',
        refId: reminderRefId(today),
        actorId: null,
        recipient: { kind: 'payroll' },
      });
    });
  }
}
