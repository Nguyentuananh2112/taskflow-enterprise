'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { monthLabel, shiftPeriod, usePayrollRun } from '@/entities/payroll';
import { useCompanyPermission } from '@/entities/session';
import {
  AddMissingButton,
  ExportRunButton,
  PublishDialog,
  RecalcButton,
} from '@/features/payroll-run-actions';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/empty-state';
import { PageMain } from '@/shared/ui/page';
import { Skeleton } from '@/shared/ui/skeleton';

import { RunRows } from './run-rows';
import { TodoList } from './todo-list';

const PERIOD = /^\/payroll\/(\d{4}-(?:0[1-9]|1[0-2]))$/;

/**
 * `/payroll/YYYY-MM` (payroll.md §5.2): việc còn lại ở đầu (hạn ngày 10), công cụ của bảng nháp (Tính lại công, Thêm
 * người còn thiếu, Phát hành), danh sách phiếu — thẻ ở 360 px, bảng ở desktop; bấm một người mở form phiếu.
 */
export function PayrollRunPage() {
  const { company, can } = useCompanyPermission();
  const allowed = can('payroll:manage');
  const period = PERIOD.exec(usePathname())?.[1] ?? '';
  const run = usePayrollRun(period, allowed && period !== '');

  if (company !== null && !allowed) {
    return (
      <main className="mx-auto max-w-md px-4 py-16">
        <EmptyState title="Bạn không có quyền Kế toán" />
      </main>
    );
  }
  const r = run.data;
  const due = `10/${shiftPeriod(period, 1).slice(5, 7)}`;
  return (
    <PageMain className="max-w-5xl gap-4">
      <Link href="/payroll" className="self-start text-sm text-text-muted hover:underline">
        ‹ Bảng lương
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Bảng lương tháng {monthLabel(period)}</h1>
        {r && <Badge>{r.status === 'DRAFT' ? 'Nháp' : 'Đã phát hành'}</Badge>}
      </div>
      {run.isError ? (
        <EmptyState
          title="Không tải được bảng lương"
          action={<Button onClick={() => void run.refetch()}>Thử lại</Button>}
        />
      ) : !r ? (
        <div role="status" aria-busy="true" aria-label="Đang tải bảng lương" className="grid gap-2">
          <Skeleton className="h-24" />
          <Skeleton className="h-48" />
        </div>
      ) : (
        <>
          <p className="text-sm text-text-muted">
            Công chuẩn {r.standardDays} ngày ·{' '}
            {r.status === 'DRAFT'
              ? `hạn phát hành ${due}`
              : `phát hành ${r.publishedAt ? `${r.publishedAt.slice(8, 10)}/${r.publishedAt.slice(5, 7)}` : ''}${r.publishedBy ? ` bởi ${r.publishedBy.fullName}` : ''}`}
          </p>
          {r.todo.length > 0 && <TodoList todo={r.todo} canHr={can('hr:manage')} />}
          <div className="flex flex-wrap items-center gap-2">
            {r.status === 'DRAFT' && (
              <>
                <PublishDialog run={r} />
                <RecalcButton run={r} />
                <AddMissingButton period={r.period} />
              </>
            )}
            <ExportRunButton run={r} />
          </div>
          <RunRows run={r} />
        </>
      )}
    </PageMain>
  );
}
