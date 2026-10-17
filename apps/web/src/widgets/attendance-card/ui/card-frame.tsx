import type { AttendanceTodayDto } from '@taskflow/contracts/attendance';

import { clockShort } from '@/entities/attendance';
import { Alert } from '@/shared/ui/alert';
import { Skeleton } from '@/shared/ui/skeleton';

/**
 * Khung của thẻ Chấm công (demo TL d9 — F đo layout-shift: thẻ tải xong đẩy nội dung xuống, banner nhắc biến mất sau
 * khi chấm kéo lên). Hai quy tắc: khung CHUNG cho skeleton và thẻ thật (cùng min-h); ô thông báo LUÔN có, một dòng,
 * chỉ đổi NỘI DUNG (không chèn / xóa khối).
 */
// Mốc 3.5 (ADR-139, E A2): thẻ GỌN ở trang chính — lối tắt tách ra ngoài thẻ, thẻ đầy đủ ở /attendance. Chiều cao ước
// theo bố cục (chưa đo lại — E2E-HR-14 chuyển sang /w, F đo): 360 xếp dọc ≈ 296 px ⇒ 19rem; từ md một hàng ≈ 168 px
// ⇒ 11rem. Thừa chỗ còn hơn dịch.
export const CARD_FRAME =
  'flex min-h-[19rem] md:min-h-44 flex-col gap-3 rounded-card border border-border bg-surface p-4 shadow-card';

/** Ô thông báo một dòng — giữ chiều cao cố định. */
export const NOTE_SLOT = 'flex min-h-10 items-center';

/** Câu trong ô thông báo theo trạng thái hôm nay (server). KHÔNG tự chấm (§6). */
export function cardNote(t: AttendanceTodayDto): { text: string; tone: 'info' | 'success' } {
  if (t.isHoliday)
    return { text: `Hôm nay nghỉ lễ${t.holidayName ? `: ${t.holidayName}` : ''}.`, tone: 'info' };
  if (t.firstIn) {
    const out = t.lastOut ? ` · ra lúc ${clockShort(t.lastOut, t.timezone)}` : '';
    return { text: `Đã chấm vào lúc ${clockShort(t.firstIn, t.timezone)}${out}.`, tone: 'success' };
  }
  if (t.status === 'NOT_EMPLOYED')
    return { text: 'Hôm nay ngoài thời gian làm việc của bạn.', tone: 'info' };
  if (!t.isWorkday) return { text: 'Hôm nay không phải ngày làm việc.', tone: 'info' };
  if (t.leave === 'FULL') return { text: 'Hôm nay bạn nghỉ phép.', tone: 'info' };
  if (t.status === 'ABSENT') return { text: 'Hôm nay chưa có lượt chấm vào.', tone: 'info' };
  return { text: 'Bạn chưa chấm vào hôm nay.', tone: 'info' };
}

export function CardNote({ today }: Readonly<{ today: AttendanceTodayDto }>) {
  const note = cardNote(today);
  return (
    <Alert tone={note.tone} className={NOTE_SLOT}>
      {note.text}
    </Alert>
  );
}

/** Skeleton CÙNG khung với thẻ thật: ô thông báo, cột đồng hồ, bảng ca/trạng thái, nút. */
export function CardSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Đang tải chấm công" className={CARD_FRAME}>
      <Skeleton className={`${NOTE_SLOT} h-10`} />
      <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-8 w-32" />
        </div>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-4 w-40" />
        </div>
        <Skeleton className="h-10 w-28 sm:ml-auto" />
      </div>
    </div>
  );
}
