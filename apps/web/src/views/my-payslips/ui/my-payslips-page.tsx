'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

import { monthLabel, useMyPayslips } from '@/entities/payroll';
import { useCompanyPermission } from '@/entities/session';
import { Button } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/empty-state';
import { PageMain } from '@/shared/ui/page';
import { Skeleton } from '@/shared/ui/skeleton';

import { PayslipView } from './payslip-view';

const PERIOD = /^\/payslips\/(\d{4}-(?:0[1-9]|1[0-2]))$/;

/**
 * `/payslips` (payroll.md §5.1): mở THẲNG phiếu mới nhất; `/payslips/YYYY-MM` là một tháng (thông báo trỏ vào đây);
 * `?rev=N` là bản cũ. ‹ › đi qua các tháng ĐÃ có phiếu; danh sách tháng bên dưới. Admin không phải nhân viên ⇒ không
 * có phiếu lương.
 */
export function MyPayslipsPage() {
  const { company } = useCompanyPermission();
  const employee = company?.role === 'EMPLOYEE';
  const list = useMyPayslips(employee);
  const asked = PERIOD.exec(usePathname())?.[1] ?? null;
  const rev = Number(useSearchParams().get('rev')) || null;

  if (company !== null && !employee) {
    return (
      <main className="mx-auto max-w-md px-4 py-16">
        <EmptyState
          title="Tài khoản Quản trị không có phiếu lương"
          action={
            <Link href="/w" className="text-sm underline">
              Về trang chính
            </Link>
          }
        />
      </main>
    );
  }
  const months = list.data ?? [];
  const period = asked ?? months[0]?.period ?? null;
  const index = months.findIndex((m) => m.period === period);
  const older = index >= 0 ? months[index + 1] : undefined;
  const newer = index > 0 ? months[index - 1] : undefined;
  return (
    <PageMain className="max-w-3xl gap-4 print:max-w-none print:p-0">
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <h1 className="text-xl font-semibold">Phiếu lương</h1>
        {period && (
          <nav aria-label="Chọn tháng" className="ml-auto flex items-center gap-2 text-sm">
            {older ? (
              <Link
                href={`/payslips/${older.period}`}
                className="rounded-control px-2 py-1 hover:bg-bg-subtle"
              >
                ‹ Tháng {monthLabel(older.period)}
              </Link>
            ) : null}
            {newer ? (
              <Link
                href={`/payslips/${newer.period}`}
                className="rounded-control px-2 py-1 hover:bg-bg-subtle"
              >
                Tháng {monthLabel(newer.period)} ›
              </Link>
            ) : null}
          </nav>
        )}
      </div>
      {list.isError ? (
        <EmptyState
          title="Không tải được phiếu lương"
          action={<Button onClick={() => void list.refetch()}>Thử lại</Button>}
        />
      ) : list.isPending && employee ? (
        <div
          role="status"
          aria-busy="true"
          aria-label="Đang tải phiếu lương"
          className="grid gap-2"
        >
          <Skeleton className="h-24" />
          <Skeleton className="h-64" />
        </div>
      ) : period === null ? (
        <EmptyState
          title="Chưa có phiếu lương nào"
          description="Phiếu lương tháng trước sẽ có trước ngày 10 tháng này."
        />
      ) : (
        <PayslipView key={`${period}-${rev ?? 0}`} period={period} revision={rev} />
      )}
      {months.length > 1 && (
        <section aria-labelledby="payslip-months" className="flex flex-col gap-2 print:hidden">
          <h2 id="payslip-months" className="text-base font-semibold">
            Các tháng
          </h2>
          <ul className="flex flex-wrap gap-2">
            {months.map((m) => (
              <li key={m.period}>
                <Link
                  href={`/payslips/${m.period}`}
                  aria-current={m.period === period ? 'page' : undefined}
                  className="rounded-control border border-border px-3 py-1.5 text-sm hover:bg-bg-subtle aria-[current=page]:bg-primary aria-[current=page]:text-primary-fg"
                >
                  Tháng {monthLabel(m.period)}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </PageMain>
  );
}
