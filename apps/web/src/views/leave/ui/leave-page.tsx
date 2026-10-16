'use client';

import { Uuid } from '@taskflow/contracts/common';
import { useParams } from 'next/navigation';

import { useAttendanceToday } from '@/entities/attendance';
import { daysText, useMyLeaveBalance, useMyLeaveRequests } from '@/entities/leave';
import { usePermission } from '@/entities/workspace';
import { LeaveRequestForm } from '@/features/leave-submit';
import { isApiError } from '@/shared/api';
import { Button } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/empty-state';
import { PageMain } from '@/shared/ui/page';
import { Skeleton } from '@/shared/ui/skeleton';

import { MyLeaveList } from './my-leave-list';

/** `/w/[wsId]/leave` — số phép còn, gửi đơn, đơn của tôi (attendance-leave.md §6). */
export function LeavePage() {
  const { wsId = '' } = useParams<{ wsId: string }>();
  const valid = Uuid.safeParse(wsId).success;
  const { role, can } = usePermission(wsId);
  const allowed = valid && can('leave:self');
  // "Hôm nay" theo múi giờ của LỊCH (server) — quy tắc hủy đơn APPROVED so với ngày bắt đầu (D-M5).
  const todayQuery = useAttendanceToday(wsId, allowed);
  const today = todayQuery.data?.date ?? null;
  const balance = useMyLeaveBalance(wsId, today ? Number(today.slice(0, 4)) : null);
  const requests = useMyLeaveRequests(wsId, allowed);

  if (!valid || isApiError(requests.error, 'RESOURCE_NOT_FOUND')) {
    return (
      <main className="mx-auto max-w-md px-4 py-16">
        <EmptyState title="Không tìm thấy hoặc bạn không có quyền truy cập" />
      </main>
    );
  }
  if (role !== null && !allowed) {
    return (
      <main className="mx-auto max-w-md px-4 py-16">
        <EmptyState title="Vai trò Người xem không xin nghỉ trong workspace này" />
      </main>
    );
  }
  const b = balance.data;
  return (
    <PageMain className="max-w-3xl gap-6">
      <h1 className="text-xl font-semibold">Nghỉ phép</h1>
      <section
        aria-labelledby="balance-heading"
        className="rounded-card border border-border bg-surface p-4"
      >
        <h2 id="balance-heading" className="text-base font-semibold">
          Phép năm {b?.year ?? ''}
        </h2>
        {b ? (
          <p className="text-sm">
            Còn{' '}
            <strong className={b.remainingDays < 0 ? 'text-danger' : undefined}>
              {daysText(b.remainingDays)}
            </strong>
            {b.pendingDays > 0 && ` · đang chờ duyệt ${daysText(b.pendingDays)}`} · đã dùng{' '}
            {daysText(b.usedDays)} / {daysText(b.entitledDays + b.adjustmentDays)}
          </p>
        ) : (
          <Skeleton className="mt-2 h-5 w-64" />
        )}
      </section>
      <section aria-labelledby="new-leave" className="flex flex-col gap-3">
        <h2 id="new-leave" className="text-base font-semibold">
          Gửi đơn mới
        </h2>
        {today ? (
          <LeaveRequestForm wsId={wsId} today={today} />
        ) : todayQuery.isError ? (
          // "Hôm nay" của server chưa có ⇒ không dựng form (min ngày, luật hủy) — báo lỗi, không kẹt skeleton.
          <EmptyState
            title="Không tải được ngày hôm nay"
            action={<Button onClick={() => void todayQuery.refetch()}>Thử lại</Button>}
          />
        ) : (
          <Skeleton className="h-48" />
        )}
      </section>
      <section aria-labelledby="my-leave" className="flex flex-col gap-3">
        <h2 id="my-leave" className="text-base font-semibold">
          Đơn của tôi
        </h2>
        {requests.isError || (todayQuery.isError && !today) ? (
          <EmptyState
            title="Không tải được đơn"
            action={
              <Button onClick={() => void Promise.all([requests.refetch(), todayQuery.refetch()])}>
                Thử lại
              </Button>
            }
          />
        ) : requests.data && today ? (
          <>
            <MyLeaveList wsId={wsId} requests={requests.data} today={today} />
            {requests.hasNextPage && (
              <Button
                variant="secondary"
                className="self-center"
                loading={requests.isFetchingNextPage}
                onClick={() => void requests.fetchNextPage()}
              >
                Tải thêm
              </Button>
            )}
          </>
        ) : (
          <div
            role="status"
            aria-busy="true"
            aria-label="Đang tải đơn"
            className="flex flex-col gap-2"
          >
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        )}
      </section>
    </PageMain>
  );
}
