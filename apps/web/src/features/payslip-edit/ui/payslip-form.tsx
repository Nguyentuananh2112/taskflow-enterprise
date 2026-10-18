'use client';

import type { PayslipDto } from '@taskflow/contracts/payroll';
import { useEffect, useState } from 'react';

import { workDays } from '@/entities/payroll';
import { formatVnd } from '@/shared/lib/money';
import { Alert } from '@/shared/ui/alert';
import { Input } from '@/shared/ui/input';
import { Textarea } from '@/shared/ui/textarea';

import { checkForm, formOf, type FormCheck, type PayslipForm as Form } from '../lib/form-state';
import { LinesSection } from './lines-section';

type Props = Readonly<{
  payslip: PayslipDto;
  /** Nút lưu / gửi điều chỉnh do nơi gọi dựng (nhận kết quả kiểm form + đã đổi chưa). */
  actions: (check: FormCheck, dirty: boolean) => React.ReactNode;
}>;

const Fixed = ({
  label,
  value,
  hint,
}: Readonly<{ label: string; value: number; hint?: string }>) => (
  <div className="flex items-start justify-between gap-3 text-sm">
    <span>
      {label}
      {hint && <span className="block text-xs text-text-muted">{hint}</span>}
    </span>
    <span className="whitespace-nowrap tabular-nums">{formatVnd(value)}</span>
  </div>
);

/**
 * Form 1 phiếu = bố cục phiếu nhân viên có ô nhập (§5.2): (1) lương theo công + thâm niên (hệ thống tính) + dòng gõ tay,
 * (2) thưởng, (3) giảm trừ, sửa công (bước 0,5, lý do bắt buộc — nhân viên thấy lý do), ghi chú, tổng xem trước. Lưu
 * theo phiếu (không autosave); rời trang khi có thay đổi chưa lưu ⇒ trình duyệt hỏi lại.
 */
export function PayslipForm({ payslip: p, actions }: Props) {
  const [form, setForm] = useState<Form>(() => formOf(p));
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  const dirty = JSON.stringify(form) !== JSON.stringify(formOf(p));
  const check = checkForm(form, p);
  const t = check.ok ? check.totals : null;
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const lines = { lines: form.lines, onChange: (l: Form['lines']) => set({ lines: l }) };
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-muted">
        Công theo chấm công {workDays(p.paidHalfDays, p.standardDays)}
        {p.level ? ` · cấp bậc ${p.level}` : ''}
        {p.baseSalary !== null
          ? ` · lương cơ bản ${formatVnd(p.baseSalary)}`
          : ' · chưa có hồ sơ lương'}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="Sửa công (ngày)"
          inputMode="decimal"
          placeholder="Để trống = theo chấm công"
          value={form.overrideDays}
          onChange={(e) => set({ overrideDays: e.target.value })}
          hint="Bước 0,5 ngày."
        />
        {form.overrideDays.trim() !== '' && (
          <Input
            label="Lý do sửa công"
            required
            maxLength={500}
            value={form.overrideReason}
            onChange={(e) => set({ overrideReason: e.target.value })}
            hint="Nhân viên sẽ thấy lý do này — không ghi chẩn đoán/bệnh."
          />
        )}
      </div>
      <LinesSection
        title="(1) Tiền lương chi tiết"
        section="INCOME"
        total={t?.incomeTotal ?? 0}
        {...lines}
        fixed={
          <>
            <Fixed label="Lương theo công" value={t?.salaryByDays ?? 0} />
            <Fixed
              label={`Phụ cấp thâm niên (${p.seniorityYears} năm)`}
              value={p.seniorityAllowance}
              hint="Hệ thống tính theo ngày vào công ty."
            />
          </>
        }
      />
      <LinesSection
        title="(2) Thưởng doanh số theo kênh"
        section="BONUS"
        total={t?.bonusTotal ?? 0}
        {...lines}
      />
      <LinesSection
        title="(3) Các khoản giảm trừ"
        section="DEDUCTION"
        total={t?.deductionTotal ?? 0}
        {...lines}
      />
      <Textarea
        label="Ghi chú"
        rows={2}
        maxLength={1000}
        value={form.note}
        onChange={(e) => set({ note: e.target.value })}
      />
      <section
        aria-label="Tổng thực lĩnh (xem trước)"
        className="rounded-card border-2 border-text bg-amber-50 p-3 dark:bg-amber-950"
      >
        <p className="flex items-center justify-between gap-2 font-bold">
          <span>(4) Tổng thực lĩnh = (1) + (2) − (3)</span>
          <span className="whitespace-nowrap tabular-nums">{t ? formatVnd(t.netPay) : '—'}</span>
        </p>
        {t && t.netPay < 0 && (
          <p className="text-sm text-danger">Thực lĩnh âm — không phát hành được.</p>
        )}
      </section>
      {!check.ok && <Alert>{check.error}</Alert>}
      {actions(check, dirty)}
    </div>
  );
}
