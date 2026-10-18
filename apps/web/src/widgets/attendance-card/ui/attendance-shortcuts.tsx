'use client';

import Link from 'next/link';

import { daysText, useMyLeaveBalance, useMyPendingLeaveCount } from '@/entities/leave';

type Props = Readonly<{ today: string }>;

const countText = (c: { count: number; more: boolean } | undefined) =>
  c && c.count > 0 ? `${c.more ? `${c.count}+` : c.count}` : null;

// Dưới md: lưới 2 cột, mỗi ô cao đủ 2 dòng chữ ⇒ số đếm về sau ("· còn 12 ngày") chỉ làm chữ xuống dòng TRONG ô, không
// đổi điểm xuống hàng của flex-wrap ⇒ không layout-shift (F đo E2E-HR-14 ở 360: +44 px). md+: hàng nút như cũ.
const LIST = 'grid grid-cols-2 gap-2 md:flex md:flex-wrap';
const LINK =
  'flex h-full min-h-12 w-full items-center rounded-control border border-border px-3 py-1 text-sm leading-tight text-text hover:bg-bg-subtle md:inline-flex md:min-h-9 md:w-auto md:py-0';

/**
 * Lối tắt của nhân viên (T-045; Mốc 3.5 ở trang chính, ngoài thẻ): Bảng công · Xin nghỉ (số phép còn) · Đơn nghỉ của
 * tôi (số chờ duyệt) · Phiếu lương. "Nhân sự" ở khối "Việc quản lý". Số chưa tải ⇒ chỉ nhãn, link vẫn dùng được. `today` = ngày của
 * SERVER.
 */
export function AttendanceShortcuts({ today }: Props) {
  const balance = useMyLeaveBalance(Number(today.slice(0, 4))).data;
  const mine = countText(useMyPendingLeaveCount(true).data);
  return (
    <nav aria-label="Lối tắt chấm công và nghỉ phép">
      <ul className={LIST}>
        <li>
          <Link href="/attendance" className={LINK}>
            Bảng công của tôi
          </Link>
        </li>
        <li>
          <Link href="/leave" className={LINK}>
            Xin nghỉ{balance ? ` · còn ${daysText(balance.remainingDays)}` : ''}
          </Link>
        </li>
        <li>
          <Link href="/leave#my-leave" className={LINK}>
            Đơn nghỉ của tôi{mine ? ` · ${mine} chờ duyệt` : ''}
          </Link>
        </li>
        {/* Mốc 4 (payroll.md §5.1): ô thứ 4 của lưới 2 cột ⇒ vẫn 2 hàng, không đổi chiều cao. */}
        <li>
          <Link href="/payslips" className={LINK}>
            Phiếu lương
          </Link>
        </li>
      </ul>
    </nav>
  );
}
