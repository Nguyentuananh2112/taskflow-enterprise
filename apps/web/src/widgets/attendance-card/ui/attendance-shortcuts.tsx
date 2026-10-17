'use client';

import Link from 'next/link';

import { useHrPendingLeaveCount } from '@/entities/hr';
import { daysText, useMyLeaveBalance, useMyPendingLeaveCount } from '@/entities/leave';

type Props = Readonly<{ wsId: string; today: string; canManageHr: boolean }>;

const countText = (c: { count: number; more: boolean } | undefined) =>
  c && c.count > 0 ? `${c.more ? `${c.count}+` : c.count}` : null;

// Dưới md: lưới 2 cột, mỗi ô cao đủ 2 dòng chữ ⇒ số đếm về sau ("· còn 12 ngày") chỉ làm chữ xuống dòng TRONG ô, không
// đổi điểm xuống hàng của flex-wrap ⇒ không layout-shift (F đo E2E-HR-14 ở 360: +44 px). md+: hàng nút như cũ.
const LIST = 'grid grid-cols-2 gap-2 md:flex md:flex-wrap';
const LINK =
  'flex h-full min-h-12 w-full items-center rounded-control border border-border px-3 py-1 text-sm leading-tight text-text hover:bg-bg-subtle md:inline-flex md:min-h-9 md:w-auto md:py-0';

/**
 * Lối tắt dưới thẻ Chấm công (T-045): Bảng công · Xin nghỉ (số phép còn) · Đơn nghỉ của tôi (số chờ duyệt) · Nhân sự
 * (số đơn chờ — chỉ khi có `hr:manage`). Số chưa tải ⇒ chỉ nhãn, link vẫn dùng được. `today` = ngày của SERVER.
 */
export function AttendanceShortcuts({ wsId, today, canManageHr }: Props) {
  const balance = useMyLeaveBalance(wsId, Number(today.slice(0, 4))).data;
  const mine = countText(useMyPendingLeaveCount(wsId, true).data);
  const hr = countText(useHrPendingLeaveCount(wsId, canManageHr).data);
  return (
    <nav aria-label="Lối tắt chấm công và nghỉ phép" className="border-t border-border pt-3">
      <ul className={LIST}>
        <li>
          <Link href={`/w/${wsId}/attendance`} className={LINK}>
            Bảng công của tôi
          </Link>
        </li>
        <li>
          <Link href={`/w/${wsId}/leave`} className={LINK}>
            Xin nghỉ{balance ? ` · còn ${daysText(balance.remainingDays)}` : ''}
          </Link>
        </li>
        <li>
          <Link href={`/w/${wsId}/leave#my-leave`} className={LINK}>
            Đơn nghỉ của tôi{mine ? ` · ${mine} chờ duyệt` : ''}
          </Link>
        </li>
        {/* Hiện NGAY khi được cấp (myGrants đổi realtime — E2E-HR-03). */}
        {canManageHr && (
          <li>
            <Link href={`/w/${wsId}/hr?tab=leave`} className={LINK}>
              Nhân sự{hr ? ` · ${hr} đơn chờ` : ''}
            </Link>
          </li>
        )}
      </ul>
    </nav>
  );
}
