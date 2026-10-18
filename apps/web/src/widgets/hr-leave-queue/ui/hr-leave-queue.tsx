'use client';

import { LeaveStatus } from '@taskflow/contracts/hr';
import { useState } from 'react';

import { useHrLeaveRequests } from '@/entities/hr';
import { LEAVE_STATUS, LEAVE_TYPE_NAME, daysText, leaveRange } from '@/entities/leave';
import { LeaveDecision } from '@/features/hr-leave-decide';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/empty-state';
import { Select } from '@/shared/ui/select';
import { Skeleton } from '@/shared/ui/skeleton';

type Filter = LeaveStatus | 'ALL';
const FILTERS: ReadonlyArray<{ value: Filter; label: string }> = [
  ...LeaveStatus.options.map((s) => ({ value: s, label: LEAVE_STATUS[s].label })),
  { value: 'ALL', label: 'Tất cả' },
];

type Props = Readonly<{ today: string; isAdmin: boolean; viewerId: string | null }>;

/**
 * Tab "Đơn nghỉ" (§6, §9): mặc định đơn CHỜ DUYỆT, mới nhất trước. HR thấy lý do (B-H2 — chỉ người gửi
 * + `hr:manage`); đơn của chính mình: ẩn nút trừ Admin (server vẫn 403 — B-H1).
 */
export function HrLeaveQueue({ today, isAdmin, viewerId }: Props) {
  const [filter, setFilter] = useState<Filter>('PENDING');
  const list = useHrLeaveRequests(filter, true);
  const items = list.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <section aria-labelledby="hr-leave" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="hr-leave" className="text-base font-semibold">
          Đơn nghỉ
        </h2>
        <Select
          label="Trạng thái"
          className="w-44"
          options={FILTERS}
          value={filter}
          onChange={(e) => setFilter(e.target.value as Filter)}
        />
      </div>
      {/* payroll.md ADR-126: phép đã duyệt THẮNG lượt chấm khi tính lương. */}
      <p className="text-xs text-text-muted">
        Nhân viên đã chấm công nhưng có đơn nghỉ không lương được duyệt ⇒ ngày đó không tính công.
        Nếu thực tế nhân viên đi làm, hãy thu hồi đơn.
      </p>
      {list.isError ? (
        <EmptyState
          title="Không tải được danh sách đơn"
          action={<Button onClick={() => void list.refetch()}>Thử lại</Button>}
        />
      ) : list.isPending ? (
        <div
          role="status"
          aria-busy="true"
          aria-label="Đang tải đơn"
          className="flex flex-col gap-2"
        >
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-text-muted">
          {filter === 'PENDING' ? 'Không có đơn nào chờ duyệt.' : 'Không có đơn nào.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((r) => {
            const s = LEAVE_STATUS[r.status];
            const own = r.userId === viewerId;
            return (
              <li
                key={r.id}
                aria-label={`Đơn của ${r.user.fullName}`}
                className="flex flex-wrap items-start gap-x-4 gap-y-2 rounded-card border border-border bg-surface p-3 text-sm"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <p className="font-medium">{r.user.fullName}</p>
                  <p>
                    {LEAVE_TYPE_NAME[r.type]} · {leaveRange(r)} · {daysText(r.days)}
                  </p>
                  <p className={cn(s.tone)}>
                    <span aria-hidden="true">{s.icon} </span>
                    {s.label}
                    {r.decidedBy && (
                      <span className="text-text-muted"> · {r.decidedBy.fullName}</span>
                    )}
                  </p>
                  {r.reason && <p className="break-words text-text-muted">Lý do: {r.reason}</p>}
                  {r.decisionNote && (
                    <p className="break-words text-text-muted">Ghi chú: {r.decisionNote}</p>
                  )}
                  {own && !isAdmin && (
                    <p className="text-xs text-text-muted">
                      Đơn của bạn — người khác có quyền Quản lý nhân sự sẽ xử lý.
                    </p>
                  )}
                </div>
                {(!own || isAdmin) && <LeaveDecision request={r} today={today} own={own} />}
              </li>
            );
          })}
        </ul>
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
