import type { LeaveBalanceDto } from '@taskflow/contracts/leave';

import { daysText } from './labels';

const dm = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
const signed = (n: number) => (n > 0 ? `+${daysText(n)}` : n < 0 ? `−${daysText(-n)}` : '0');

export type BreakdownPart = Readonly<{ label: string; value: string }>;

/**
 * Phân rã số phép bằng lời thường (ADR-131, hr-extended §5): "Phép năm 12 + thâm niên 1 = 13 · Điều chỉnh −1 · Phép
 * năm trước chuyển sang 2 (dùng trước 31/03) · Đã dùng 4 · Đang chờ 1 · Còn 9". Trả từng phần để nơi hiển thị tự xếp
 * (một dòng ở /leave, danh sách ở HR). Phần bằng 0 không cần thiết thì bỏ.
 */
export function balanceBreakdown(b: LeaveBalanceDto): BreakdownPart[] {
  const parts: BreakdownPart[] = [];
  const annual = b.baseDays - b.seniorityBonusDays;
  parts.push({
    label: b.entitledSource === 'OVERRIDE' ? 'Phép năm (đặt riêng)' : 'Phép năm',
    value:
      b.entitledSource === 'POLICY' && b.seniorityBonusDays > 0
        ? `${daysText(annual)} + thâm niên ${daysText(b.seniorityBonusDays)} = ${daysText(b.entitledDays)}`
        : daysText(b.entitledDays),
  });
  if (b.adjustmentDays !== 0) parts.push({ label: 'Điều chỉnh', value: signed(b.adjustmentDays) });
  if (b.carriedOverDays > 0) {
    parts.push({
      label: 'Phép năm trước chuyển sang',
      value: `${daysText(b.carriedOverDays)}${b.carriedExpiresOn ? ` (dùng trước ${dm(b.carriedExpiresOn)})` : ''}${b.carriedFinal ? '' : ' (tạm tính)'}`,
    });
  }
  parts.push({ label: 'Đã dùng', value: daysText(b.usedDays) });
  if (b.pendingDays > 0) parts.push({ label: 'Đang chờ', value: daysText(b.pendingDays) });
  return parts;
}
