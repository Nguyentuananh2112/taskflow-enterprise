import type { LeaveBalanceRowDto } from '@taskflow/contracts/leave';

import { daysText } from '@/entities/leave';
import { AdjustBalanceButton } from '@/features/hr-balance-adjust';
import { cn } from '@/shared/lib/cn';

type Props = Readonly<{ row: LeaveBalanceRowDto; own: boolean; isAdmin: boolean }>;

/**
 * Một dòng Số phép (ADR-131): được hưởng kèm phần thâm niên, phép năm trước chuyển sang (+ hạn, "(tạm tính)" khi server
 * chưa chụp), thiếu ngày vào công ty ⇒ nhãn chữ dưới tên. "Còn lại" âm ⇒ tô cảnh báo, vẫn hiện đúng số.
 */
export function BalanceRow({ row: r, own, isAdmin }: Props) {
  const expires =
    r.carriedExpiresOn &&
    `hạn ${r.carriedExpiresOn.slice(8, 10)}/${r.carriedExpiresOn.slice(5, 7)}`;
  return (
    <tr className="border-b border-border tabular-nums">
      <th scope="row" className="py-2 pr-3 text-left font-medium">
        {r.user.fullName}
        {r.missingHireDate && (
          <span className="block text-xs font-normal text-warning">Thiếu ngày vào công ty</span>
        )}
      </th>
      <td className="py-2 pr-3">
        {daysText(r.entitledDays)}
        {r.entitledSource === 'POLICY' && r.seniorityBonusDays > 0 && (
          <span className="block text-xs text-text-muted">
            gồm thâm niên {daysText(r.seniorityBonusDays)}
          </span>
        )}
        {r.entitledSource === 'OVERRIDE' && (
          <span className="block text-xs text-text-muted">đặt riêng</span>
        )}
      </td>
      <td className="py-2 pr-3">{daysText(r.adjustmentDays)}</td>
      <td className="py-2 pr-3">
        {r.carriedOverDays > 0 ? daysText(r.carriedOverDays) : '—'}
        {r.carriedOverDays > 0 && (
          <span className="block text-xs text-text-muted">
            {[expires, !r.carriedFinal && 'tạm tính'].filter(Boolean).join(' · ')}
          </span>
        )}
      </td>
      <td className="py-2 pr-3">{daysText(r.usedDays)}</td>
      <td className="py-2 pr-3">{daysText(r.pendingDays)}</td>
      <td className={cn('py-2 pr-3 font-medium', r.remainingDays < 0 && 'text-danger')}>
        {daysText(r.remainingDays)}
      </td>
      <td className="py-2 text-right">
        {(!own || isAdmin) && <AdjustBalanceButton row={r} own={own} />}
      </td>
    </tr>
  );
}
