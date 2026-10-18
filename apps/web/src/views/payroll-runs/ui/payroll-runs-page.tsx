'use client';

import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { monthLabel, payrollApi, payrollKeys, usePayrollRuns } from '@/entities/payroll';
import { useCompanyPermission } from '@/entities/session';
import { serverErrorMessage } from '@/shared/lib/form-errors';
import { formatVnd } from '@/shared/lib/money';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/empty-state';
import { PageMain } from '@/shared/ui/page';
import { Skeleton } from '@/shared/ui/skeleton';
import { toast } from '@/shared/ui/toast';

const dmy = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

/**
 * `/payroll` (payroll.md §5.2 — `payroll:manage`): các tháng (trạng thái bằng chữ, số phiếu, tổng thực lĩnh), nút tạo
 * bảng tháng kế tiếp (mờ + "tạo được từ dd/mm" khi tháng chưa kết thúc), lối vào Hồ sơ lương.
 */
export function PayrollRunsPage() {
  const { company, can } = useCompanyPermission();
  const allowed = can('payroll:manage');
  const runs = usePayrollRuns(allowed);
  const router = useRouter();
  const create = useMutation({
    mutationFn: (period: string) => payrollApi.createRun(period),
    onSuccess: (run, _v, _c, context) => {
      void context.client.invalidateQueries({ queryKey: payrollKeys.runs() });
      router.push(`/payroll/${run.period}`);
    },
    onError: (error) => toast({ title: serverErrorMessage(error), tone: 'error' }),
  });

  if (company !== null && !allowed) {
    return (
      <main className="mx-auto max-w-md px-4 py-16">
        <EmptyState
          title="Bạn không có quyền Kế toán"
          description="Quản trị viên công ty cấp quyền này ở mục Quản trị › Phân quyền."
          action={
            <Link href="/w" className="text-sm underline">
              Về trang chính
            </Link>
          }
        />
      </main>
    );
  }
  const next = runs.data?.next ?? null;
  return (
    <PageMain className="max-w-3xl gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Bảng lương</h1>
        <Link
          href="/payroll/profiles"
          className="ml-auto rounded-control border border-border px-3 py-2 text-sm hover:bg-bg-subtle"
        >
          Hồ sơ lương
        </Link>
      </div>
      {next && (
        <div className="flex flex-wrap items-center gap-3 rounded-card border border-border bg-surface p-4">
          <p className="flex-1 text-sm">
            Bảng lương tháng {monthLabel(next.period)}
            {!next.canCreate && ` — tạo được từ ${dmy(next.from)}`}
          </p>
          <Button
            disabled={!next.canCreate}
            loading={create.isPending}
            onClick={() => create.mutate(next.period)}
          >
            Tạo bảng tháng {monthLabel(next.period)}
          </Button>
        </div>
      )}
      {runs.isError ? (
        <EmptyState
          title="Không tải được bảng lương"
          action={<Button onClick={() => void runs.refetch()}>Thử lại</Button>}
        />
      ) : !runs.data ? (
        <div role="status" aria-busy="true" aria-label="Đang tải bảng lương" className="grid gap-2">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : runs.data.runs.length === 0 ? (
        <EmptyState title="Chưa có bảng lương nào" />
      ) : (
        <ul aria-label="Các tháng" className="flex flex-col gap-2">
          {runs.data.runs.map((r) => (
            <li key={r.period}>
              <Link
                href={`/payroll/${r.period}`}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-card border border-border bg-surface p-4 hover:bg-bg-subtle"
              >
                <span className="font-medium">Tháng {monthLabel(r.period)}</span>
                <Badge>{r.status === 'DRAFT' ? 'Nháp' : 'Đã phát hành'}</Badge>
                <span className="text-sm text-text-muted">{r.payslipCount} phiếu</span>
                <span className="ml-auto whitespace-nowrap tabular-nums">
                  {formatVnd(r.netTotal)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PageMain>
  );
}
