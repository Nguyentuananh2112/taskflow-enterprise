'use client';

import type { MyPayslipDto } from '@taskflow/contracts/payroll';
import Link from 'next/link';
import { useEffect } from 'react';

import { PayslipSheet, monthLabel, useMyPayslip, useMyPayslipRevision } from '@/entities/payroll';
import { isApiError } from '@/shared/api';
import { formatVnd } from '@/shared/lib/money';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/empty-state';
import { Skeleton } from '@/shared/ui/skeleton';

const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const nextMonthTenth = (period: string) => {
  const m = Number(period.slice(5, 7));
  return `10/${String(m === 12 ? 1 : m + 1).padStart(2, '0')}`;
};

type Props = Readonly<{ period: string; revision: number | null }>;

/** Một tháng: thẻ "Tổng thực lĩnh" trên cùng, phiếu đầy đủ (không accordion), dải điều chỉnh / BẢN CŨ, In / Lưu PDF. */
export function PayslipView({ period, revision }: Props) {
  const current = useMyPayslip(revision === null ? period : null);
  const old = useMyPayslipRevision(period, revision);
  const q = revision === null ? current : old;
  // Tiêu đề tab và tên file in: KHÔNG tiền, KHÔNG tên (§5.1).
  useEffect(() => {
    const before = document.title;
    const screenTitle = `Phiếu lương tháng ${monthLabel(period)}`;
    document.title = screenTitle;
    // Tên file khi "Lưu dưới dạng PDF" lấy từ title ⇒ chữ không dấu, không tên người.
    const toPrint = () => {
      document.title = `Phieu-luong-${period}`;
    };
    const toScreen = () => {
      document.title = screenTitle;
    };
    window.addEventListener('beforeprint', toPrint);
    window.addEventListener('afterprint', toScreen);
    return () => {
      window.removeEventListener('beforeprint', toPrint);
      window.removeEventListener('afterprint', toScreen);
      document.title = before;
    };
  }, [period]);

  if (isApiError(q.error, 'RESOURCE_NOT_FOUND')) {
    return (
      <EmptyState
        title={`Chưa có phiếu lương tháng ${monthLabel(period)}`}
        description={`Phiếu lương tháng ${monthLabel(period)} sẽ có trước ngày ${nextMonthTenth(period)}.`}
      />
    );
  }
  if (q.isError) {
    return (
      <EmptyState
        title="Không tải được phiếu lương"
        action={<Button onClick={() => void q.refetch()}>Thử lại</Button>}
      />
    );
  }
  if (!q.data) {
    return (
      <div role="status" aria-busy="true" aria-label="Đang tải phiếu lương" className="grid gap-2">
        <Skeleton className="h-24" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  return <Loaded payslip={q.data} isOld={revision !== null} />;
}

function Loaded({ payslip: p, isOld }: Readonly<{ payslip: MyPayslipDto; isOld: boolean }>) {
  const superseded = isOld || p.supersededAt !== null;
  return (
    <div className="flex flex-col gap-4">
      {superseded && (
        <p className="rounded-control border-2 border-danger px-3 py-2 text-center font-bold text-danger">
          BẢN CŨ — đã được thay thế
        </p>
      )}
      {p.revision > 1 && !superseded && (
        <Alert tone="info">
          Đã điều chỉnh lần {p.revision - 1}
          {p.revisedAt ? ` ngày ${dm(p.revisedAt)}` : ''}
          {p.revisionReason ? ` — lý do: ${p.revisionReason}` : ''}.{' '}
          {Array.from({ length: p.revision - 1 }, (_, i) => (
            <Link
              key={i}
              href={`/payslips/${p.period}?rev=${i + 1}`}
              className="underline print:hidden"
            >
              Xem bản {i + 1}
            </Link>
          ))}
        </Alert>
      )}
      <section
        aria-label="Tổng thực lĩnh"
        className="rounded-card border-2 border-text bg-amber-50 p-4 text-center dark:bg-amber-950 print:hidden"
      >
        <p className="text-sm">Tổng thực lĩnh tháng {monthLabel(p.period)}</p>
        <p className="text-3xl font-bold whitespace-nowrap tabular-nums">{formatVnd(p.netPay)}</p>
      </section>
      <PayslipSheet payslip={p} />
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <Button variant="secondary" onClick={() => window.print()}>
          In / Lưu PDF
        </Button>
        <span className="text-xs text-text-muted">
          Trong hộp in, chọn &quot;Lưu dưới dạng PDF&quot; để lưu file.
        </span>
        <Link href={`/attendance?month=${p.period}`} className="ml-auto text-sm underline">
          Xem chấm công tháng {monthLabel(p.period)}
        </Link>
      </div>
    </div>
  );
}
