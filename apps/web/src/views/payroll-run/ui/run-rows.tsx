import type { PayrollRunDto } from '@taskflow/contracts/payroll';
import Link from 'next/link';

import { BLOCK_REASON, workDays } from '@/entities/payroll';
import { formatVnd } from '@/shared/lib/money';

type Run = Readonly<{ run: PayrollRunDto }>;

const reasons = (r: PayrollRunDto['payslips'][number]) =>
  r.blockReasons.map((b) => BLOCK_REASON[b]).join(', ');

/**
 * Phiếu trong bảng tháng: 360 px là DANH SÁCH THẺ (tên · công · thực lĩnh · trạng thái), desktop là bảng có cột tên dính
 * trái (§5.2 U1). Phiếu của chính kế toán chỉ đọc.
 */
export function RunRows({ run }: Run) {
  const href = (id: string) => `/payroll/${run.period}/${id}`;
  return (
    <>
      <ul aria-label="Phiếu lương" className="flex flex-col gap-2 md:hidden">
        {run.payslips.map((p) => (
          <li key={p.user.id}>
            <Link
              href={href(p.user.id)}
              className="flex flex-col gap-1 rounded-card border border-border bg-surface p-4 hover:bg-bg-subtle"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="font-medium">{p.user.fullName}</span>
                <span className="whitespace-nowrap font-semibold tabular-nums">
                  {formatVnd(p.netPay)}
                </span>
              </span>
              <span className="text-sm text-text-muted">
                Công {workDays(p.countedHalfDays, run.standardDays)}
                {p.overridden && ' (đã sửa)'}
                {p.revision > 1 && ` · bản ${p.revision}`}
              </span>
              {p.blockReasons.length > 0 && (
                <span className="text-sm text-danger">Chưa phát hành được: {reasons(p)}</span>
              )}
              {p.own && (
                <span className="text-xs text-text-muted">
                  Phiếu của bạn — Kế toán khác hoặc Admin sửa
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
      <div className="relative hidden overflow-x-auto md:block">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">Phiếu lương tháng {run.period}</caption>
          <thead>
            <tr className="border-b border-border text-left text-xs text-text-muted">
              <th scope="col" className="sticky left-0 bg-bg py-2 pr-3 font-medium">
                Nhân viên
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                Công
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                Thực lĩnh
              </th>
              <th scope="col" className="py-2 font-medium">
                Trạng thái
              </th>
            </tr>
          </thead>
          <tbody>
            {run.payslips.map((p) => (
              <tr key={p.user.id} className="border-b border-border">
                <th scope="row" className="sticky left-0 bg-bg py-2 pr-3 text-left font-medium">
                  <Link href={href(p.user.id)} className="hover:underline">
                    {p.user.fullName}
                  </Link>
                </th>
                <td className="py-2 pr-3 tabular-nums whitespace-nowrap">
                  {workDays(p.countedHalfDays, run.standardDays)}
                  {p.overridden && ' (đã sửa)'}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">
                  {formatVnd(p.netPay)}
                </td>
                <td className="py-2">
                  {p.blockReasons.length > 0 ? (
                    <span className="text-danger">{reasons(p)}</span>
                  ) : p.own ? (
                    <span className="text-text-muted">Phiếu của bạn — người khác sửa</span>
                  ) : (
                    'Sẵn sàng'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
