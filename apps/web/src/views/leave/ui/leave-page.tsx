'use client';

import Link from 'next/link';

import { useAttendanceToday } from '@/entities/attendance';
import {
  balanceBreakdown,
  daysText,
  useMyLeaveBalance,
  useMyLeaveRequests,
} from '@/entities/leave';
import { useCompanyPermission } from '@/entities/session';
import { LeaveRequestForm } from '@/features/leave-submit';
import { Button } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/empty-state';
import { PageMain } from '@/shared/ui/page';
import { Skeleton } from '@/shared/ui/skeleton';

import { MyLeaveList } from './my-leave-list';

/** `/leave` — số phép còn, gửi đơn, đơn của tôi (attendance-leave.md §6), cấp CÔNG TY (ADR-139). */
export function LeavePage() {
  const { company, can } = useCompanyPermission();
  const allowed = can('leave:self');
  // "Hôm nay" theo múi giờ của LỊCH (server) — quy tắc hủy đơn APPROVED so với ngày bắt đầu (D-M5).
  const todayQuery = useAttendanceToday(allowed);
  const today = todayQuery.data?.date ?? null;
  const balance = useMyLeaveBalance(today ? Number(today.slice(0, 4)) : null);
  const requests = useMyLeaveRequests(allowed);

  if (company !== null && !allowed) {
    return (
      <main className="mx-auto max-w-md px-4 py-16">
        <EmptyState
          title="Tài khoản Quản trị không xin nghỉ phép"
          action={
            <Link href="/w" className="text-sm underline">
              Về trang chính
            </Link>
          }
        />
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
          <>
            <p className="text-sm">
              Còn{' '}
              <strong className={b.remainingDays < 0 ? 'text-danger' : undefined}>
                {daysText(b.remainingDays)}
              </strong>
            </p>
            <p className="text-sm text-text-muted">
              {balanceBreakdown(b)
                .map((part) => `${part.label} ${part.value}`)
                .join(' · ')}
            </p>
            {b.missingHireDate && (
              <p className="text-xs text-text-muted">
                Chưa có ngày vào công ty nên chưa tính thâm niên — báo bộ phận nhân sự.
              </p>
            )}
          </>
        ) : (
          <Skeleton className="mt-2 h-5 w-64" />
        )}
      </section>
      <section aria-labelledby="new-leave" className="flex flex-col gap-3">
        <h2 id="new-leave" className="text-base font-semibold">
          Gửi đơn mới
        </h2>
        {today ? (
          <LeaveRequestForm today={today} />
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
            <MyLeaveList requests={requests.data} today={today} />
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
