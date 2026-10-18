'use client';

import { useState } from 'react';

import { useLeaveBalances } from '@/entities/hr';
import { LeaveReportButton } from '@/features/hr-export-xlsx';
import { PolicyDialog } from '@/features/hr-leave-policy';
import { Button } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/empty-state';
import { Skeleton } from '@/shared/ui/skeleton';

import { BalanceRow } from './balance-row';

type Props = Readonly<{ today: string; isAdmin: boolean; viewerId: string | null }>;

const COLUMNS = [
  'Được hưởng',
  'Điều chỉnh',
  'Chuyển sang',
  'Đã dùng',
  'Chờ duyệt',
  'Còn lại',
] as const;

/**
 * Tab "Số phép" (ADR-122): mọi nhân viên hiện tại, kể cả chưa có dòng số dư (mặc định 12 ngày). Chỉ
 * năm nay ± 1 (giới hạn của PATCH). "Còn lại" có thể âm — hiện đúng số, tô màu cảnh báo.
 */
export function HrBalances({ today, isAdmin, viewerId }: Props) {
  const thisYear = Number(today.slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const list = useLeaveBalances(year);
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <section aria-labelledby="hr-balances" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="hr-balances" className="text-base font-semibold">
          Số phép năm {year}
        </h2>
        <div className="flex flex-wrap gap-2">
          <PolicyDialog today={today} />
          <LeaveReportButton key={year} year={year} />
          <Button
            size="sm"
            variant="secondary"
            disabled={year <= thisYear - 1}
            onClick={() => setYear(year - 1)}
          >
            ‹ Năm trước
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={year >= thisYear + 1}
            onClick={() => setYear(year + 1)}
          >
            Năm sau ›
          </Button>
        </div>
      </div>
      {list.isError ? (
        <EmptyState
          title="Không tải được số phép"
          action={<Button onClick={() => void list.refetch()}>Thử lại</Button>}
        />
      ) : list.isPending ? (
        <Skeleton className="h-40" />
      ) : (
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[46rem] border-collapse text-sm">
            <caption className="sr-only">Số phép năm {year} của từng nhân viên</caption>
            <thead>
              <tr className="border-b border-border text-left text-xs text-text-muted">
                <th scope="col" className="py-2 pr-3 font-medium">
                  Nhân viên
                </th>
                {COLUMNS.map((c) => (
                  <th key={c} scope="col" className="py-2 pr-3 font-medium">
                    {c}
                  </th>
                ))}
                <th scope="col" className="py-2 font-medium">
                  <span className="sr-only">Thao tác</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <BalanceRow key={r.userId} row={r} own={r.userId === viewerId} isAdmin={isAdmin} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {list.hasNextPage && (
        <Button
          variant="secondary"
          className="self-center"
          loading={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          Tải thêm
        </Button>
      )}
    </section>
  );
}
