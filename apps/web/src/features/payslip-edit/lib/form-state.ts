import {
  computePayslip,
  type PayslipDto,
  type PayslipSection,
  type PayslipTotals,
} from '@taskflow/contracts/payroll';

import { groupDigits, parseVnd } from '@/shared/lib/money';

// Trạng thái form 1 phiếu (payroll.md §5.2): số tiền là CHUỖI người gõ (dấu chấm nghìn), công sửa tay là chuỗi "21,5".
// Tổng xem trước bằng CHÍNH `computePayslip` của contracts — server tính lại và là chuẩn.

export type LineDraft = Readonly<{
  key: string;
  section: PayslipSection;
  label: string;
  amount: string;
}>;
export type PayslipForm = Readonly<{
  lines: readonly LineDraft[];
  note: string;
  /** Rỗng = theo chấm công. */
  overrideDays: string;
  overrideReason: string;
}>;

const days = (halfDays: number) =>
  new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(halfDays / 2);

export function formOf(p: PayslipDto): PayslipForm {
  return {
    lines: p.lines.map((l) => ({
      key: l.id,
      section: l.section,
      label: l.label,
      amount: groupDigits(l.amount),
    })),
    note: p.note ?? '',
    overrideDays: p.overrideHalfDays === null ? '' : days(p.overrideHalfDays),
    overrideReason: p.overrideReason ?? '',
  };
}

/** "21,5" / "21.5" ⇒ 43 nửa ngày; bước 0,5; rỗng ⇒ null; sai ⇒ NaN. */
export function overrideHalfDays(text: string): number | null {
  const t = text.trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && Number.isInteger(n * 2) && n >= 0 ? n * 2 : Number.NaN;
}

export type FormCheck =
  | Readonly<{ ok: true; body: ReturnType<typeof bodyOf>; totals: PayslipTotals }>
  | Readonly<{ ok: false; error: string }>;

function bodyOf(
  f: PayslipForm,
  lines: ReadonlyArray<{ section: PayslipSection; label: string; amount: number }>,
  half: number | null,
) {
  return {
    lines: lines.map((l) => ({ ...l })),
    note: f.note.trim() === '' ? null : f.note.trim(),
    overrideHalfDays: half,
    overrideReason: half === null ? null : f.overrideReason.trim(),
  };
}

/** Kiểm form + tổng xem trước. Lỗi trả câu lời thường (nút Lưu mờ + câu dưới nút). */
export function checkForm(f: PayslipForm, p: PayslipDto): FormCheck {
  const lines: Array<{ section: PayslipSection; label: string; amount: number }> = [];
  for (const l of f.lines) {
    const amount = parseVnd(l.amount);
    if (amount === null)
      return { ok: false, error: `Số tiền "${l.amount}" không hợp lệ (chỉ chữ số).` };
    if (l.label.trim() === '')
      return { ok: false, error: 'Mỗi dòng cần nhãn (vd "Thưởng kênh online").' };
    lines.push({ section: l.section, label: l.label.trim(), amount });
  }
  const half = overrideHalfDays(f.overrideDays);
  if (Number.isNaN(half)) return { ok: false, error: 'Công sửa tay theo bước 0,5 ngày (vd 21,5).' };
  if (half !== null && half > 2 * p.standardDays)
    return { ok: false, error: `Công không quá ${p.standardDays} ngày (công chuẩn).` };
  if (half !== null && f.overrideReason.trim() === '')
    return { ok: false, error: 'Sửa công cần ghi lý do.' };
  const totals = computePayslip({
    baseSalary: p.baseSalary ?? 0,
    paidHalfDays: half ?? p.paidHalfDays,
    standardDays: p.standardDays,
    seniorityAllowance: p.seniorityAllowance,
    lines,
  });
  return { ok: true, body: bodyOf(f, lines, half), totals };
}
