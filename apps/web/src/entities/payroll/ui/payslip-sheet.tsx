import type { ReactNode } from 'react';

import type { MyPayslipDto as PayslipDto, PayslipSection } from '@taskflow/contracts/payroll';
import { cn } from '@/shared/lib/cn';
import { formatVnd } from '@/shared/lib/money';

import { sheetMonth, workDays } from '../lib/labels';

const dmy = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

/** Ô tiền canh phải; 0 / trống in "—" nhưng trình đọc màn hình đọc "0 đồng" (§5.1 a11y). */
export function Money({ value, strong = false }: Readonly<{ value: number; strong?: boolean }>) {
  return (
    <td
      className={cn(
        'whitespace-nowrap px-3 py-1.5 text-right tabular-nums',
        strong && 'font-semibold',
      )}
    >
      {value === 0 ? <span aria-label="0 đồng">—</span> : formatVnd(value)}
    </td>
  );
}

function Row({ label, value, sub }: Readonly<{ label: ReactNode; value: number; sub?: boolean }>) {
  return (
    <tr className="border-t border-border">
      <th scope="row" className={cn('px-3 py-1.5 text-left font-normal', sub && 'pl-6')}>
        {label}
      </th>
      <Money value={value} />
    </tr>
  );
}

function Section({ title, total }: Readonly<{ title: string; total?: number }>) {
  return (
    <tr className="border-t border-border bg-bg-subtle print:bg-gray-100">
      <th scope="row" className="px-3 py-1.5 text-left font-semibold">
        {title}
      </th>
      {total === undefined ? <td /> : <Money value={total} strong />}
    </tr>
  );
}

const lines = (p: PayslipDto, section: PayslipSection) =>
  p.lines
    .filter((l) => l.section === section)
    .map((l) => <Row key={l.id} label={l.label} value={l.amount} sub />);

/**
 * Phiếu lương theo mẫu người dùng (payroll.md §5.1): đầu phiếu căn giữa (TÊN CÔNG TY · PHIẾU LƯƠNG NHÂN VIÊN · tháng),
 * một bảng 2 cột có viền — (1) Tiền lương chi tiết · (2) Thưởng · (3) Giảm trừ · (4) Tổng thực lĩnh nền vàng nhạt —
 * rồi Ghi chú. Dùng chung cho nhân viên xem / in và kế toán xem lại; `<table>` thật, nhãn dòng là `<th scope="row">`.
 */
export function PayslipSheet({ payslip: p }: Readonly<{ payslip: PayslipDto }>) {
  const days = p.overrideHalfDays ?? p.paidHalfDays;
  return (
    <article aria-label="Phiếu lương" className="flex flex-col gap-3 print:text-black">
      <header className="text-center">
        {p.companyName && <p className="text-lg font-bold uppercase">{p.companyName}</p>}
        <p className="font-semibold">PHIẾU LƯƠNG NHÂN VIÊN</p>
        <p className="text-sm">{sheetMonth(p.period)}</p>
      </header>
      <table className="w-full border-collapse border border-border text-sm print:border-black">
        <caption className="sr-only">Phiếu lương {sheetMonth(p.period)}</caption>
        <tbody>
          <Section title="Thông tin người lĩnh" />
          <tr className="border-t border-border">
            <th scope="row" className="px-3 py-1.5 text-left font-normal">
              Họ tên
            </th>
            <td className="px-3 py-1.5 text-right">{p.fullName}</td>
          </tr>
          {p.level && (
            <tr className="border-t border-border">
              <th scope="row" className="px-3 py-1.5 text-left font-normal">
                Cấp bậc
              </th>
              <td className="px-3 py-1.5 text-right">{p.level}</td>
            </tr>
          )}
          {p.hireDate && (
            <tr className="border-t border-border">
              <th scope="row" className="px-3 py-1.5 text-left font-normal">
                Ngày vào công ty
              </th>
              <td className="px-3 py-1.5 text-right tabular-nums">{dmy(p.hireDate)}</td>
            </tr>
          )}
          <tr className="border-t border-border">
            <th scope="row" className="px-3 py-1.5 text-left font-normal">
              Công thực tế / công chuẩn
            </th>
            <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">
              {workDays(days, p.standardDays)}
            </td>
          </tr>
          {p.overrideHalfDays !== null && p.overrideReason && (
            <tr className="border-t border-border">
              <th scope="row" className="px-3 py-1.5 pl-6 text-left font-normal">
                Công đã sửa — lý do
              </th>
              <td className="px-3 py-1.5 text-right">{p.overrideReason}</td>
            </tr>
          )}
          <Section title="(1) Tiền lương chi tiết" total={p.incomeTotal} />
          <Row label="Lương cơ bản (đủ công)" value={p.baseSalary ?? 0} sub />
          <Row label="Lương theo công" value={p.salaryByDays} sub />
          <Row
            label={`Phụ cấp thâm niên (${p.seniorityYears} năm)`}
            value={p.seniorityAllowance}
            sub
          />
          {lines(p, 'INCOME')}
          <Section title="(2) Thưởng doanh số theo kênh" total={p.bonusTotal} />
          {lines(p, 'BONUS')}
          <Section title="(3) Các khoản giảm trừ" total={p.deductionTotal} />
          {lines(p, 'DEDUCTION')}
          <tr className="border-2 border-text bg-amber-50 font-bold dark:bg-amber-950 print:bg-amber-50">
            <th scope="row" className="px-3 py-2 text-left">
              (4) Tổng thực lĩnh = (1) + (2) − (3)
            </th>
            <Money value={p.netPay} strong />
          </tr>
        </tbody>
      </table>
      {(p.note ?? p.hasSickDays) && (
        <section aria-label="Ghi chú" className="text-sm">
          <h2 className="font-semibold">Ghi chú</h2>
          {p.note && <p className="whitespace-pre-line">{p.note}</p>}
          {p.hasSickDays && <p>Ngày nghỉ ốm không tính công vì do BHXH chi trả.</p>}
        </section>
      )}
    </article>
  );
}
