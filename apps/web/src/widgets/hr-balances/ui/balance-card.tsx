import type { LeaveBalanceRowDto } from '@taskflow/contracts/leave';

import { balanceBreakdown, daysText } from '@/entities/leave';
import { AdjustBalanceButton } from '@/features/hr-balance-adjust';
import { cn } from '@/shared/lib/cn';

type Props = Readonly<{ row: LeaveBalanceRowDto; own: boolean; isAdmin: boolean }>;

/**
 * Số phép một người ở màn hẹp (< md — lỗi #E2): tên + "Còn lại" nổi bật ngay hàng đầu, phân rã một dòng chữ, nút "Chỉnh"
 * — thay bảng 7 cột (ở 360 px chỉ thấy 2 cột, "Còn lại" khuất).
 */
export function BalanceCard({ row: r, own, isAdmin }: Props) {
  return (
    <li
      aria-label={r.user.fullName}
      className="flex flex-col gap-1 rounded-card border border-border bg-surface p-3 text-sm"
    >
      <p className="flex items-baseline justify-between gap-2">
        <span className="font-medium">{r.user.fullName}</span>
        <span
          className={cn('whitespace-nowrap font-semibold', r.remainingDays < 0 && 'text-danger')}
        >
          Còn {daysText(r.remainingDays)}
        </span>
      </p>
      {r.missingHireDate && <p className="text-xs text-warning">Thiếu ngày vào công ty</p>}
      <p className="text-xs text-text-muted">
        {balanceBreakdown(r)
          .map((part) => `${part.label} ${part.value}`)
          .join(' · ')}
      </p>
      {(!own || isAdmin) && (
        <div className="self-end">
          <AdjustBalanceButton row={r} own={own} />
        </div>
      )}
    </li>
  );
}
