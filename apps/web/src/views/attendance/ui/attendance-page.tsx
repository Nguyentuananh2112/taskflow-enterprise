'use client';

import { Uuid } from '@taskflow/contracts/common';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useState } from 'react';

import {
  EventsList,
  MonthTable,
  dayLabel,
  useMyAttendanceEvents,
  shiftMonth,
  useAttendanceMonth,
  useAttendanceToday,
} from '@/entities/attendance';
import { usePermission } from '@/entities/workspace';
import { isApiError } from '@/shared/api';
import { Button } from '@/shared/ui/button';
import { Dialog } from '@/shared/ui/dialog';
import { EmptyState } from '@/shared/ui/empty-state';
import { PageMain } from '@/shared/ui/page';
import { Skeleton } from '@/shared/ui/skeleton';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const monthTitle = (m: string) => `tháng ${Number(m.slice(5))}/${m.slice(0, 4)}`;

/** `/w/[wsId]/attendance?month=YYYY-MM` — bảng công tháng của tôi (attendance-leave.md §6). */
export function AttendancePage() {
  const { wsId = '' } = useParams<{ wsId: string }>();
  const valid = Uuid.safeParse(wsId).success;
  const { role, can } = usePermission(wsId);
  const allowed = valid && can('attendance:self');
  const today = useAttendanceToday(wsId, allowed);
  const asked = useSearchParams().get('month');
  // Tháng mặc định = tháng của "hôm nay" THEO SERVER (múi giờ của lịch), không theo máy.
  const month = asked && MONTH.test(asked) ? asked : today.data?.date.slice(0, 7);
  const data = useAttendanceMonth(wsId, month ?? '', allowed && month !== undefined);
  const [day, setDay] = useState<string | null>(null);
  const events = useMyAttendanceEvents(wsId, day);

  if (!valid || isApiError(data.error, 'RESOURCE_NOT_FOUND')) {
    return (
      <main className="mx-auto max-w-md px-4 py-16">
        <EmptyState title="Không tìm thấy hoặc bạn không có quyền truy cập" />
      </main>
    );
  }
  if (role !== null && !allowed) {
    return (
      <main className="mx-auto max-w-md px-4 py-16">
        <EmptyState title="Vai trò Người xem không chấm công trong workspace này" />
      </main>
    );
  }
  return (
    <PageMain className="gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Bảng công của tôi</h1>
        {month && (
          <nav aria-label="Chọn tháng" className="ml-auto flex items-center gap-2 text-sm">
            <Link
              href={`?month=${shiftMonth(month, -1)}`}
              className="rounded-control px-2 py-1 hover:bg-bg-subtle"
            >
              ← Tháng trước
            </Link>
            <Link
              href={`?month=${shiftMonth(month, 1)}`}
              className="rounded-control px-2 py-1 hover:bg-bg-subtle"
            >
              Tháng sau →
            </Link>
          </nav>
        )}
      </div>
      {data.isError ? (
        <EmptyState
          title="Không tải được bảng công"
          action={<Button onClick={() => void data.refetch()}>Thử lại</Button>}
        />
      ) : !data.data || !month ? (
        <div
          role="status"
          aria-busy="true"
          aria-label="Đang tải bảng công"
          className="flex flex-col gap-2"
        >
          <Skeleton className="h-8" />
          <Skeleton className="h-64" />
        </div>
      ) : (
        <MonthTable
          month={data.data}
          caption={`Bảng công ${monthTitle(month)}`}
          onSelectDay={setDay}
        />
      )}
      <Dialog
        open={day !== null}
        onOpenChange={(open) => !open && setDay(null)}
        title={day ? `Lượt chấm ${dayLabel(day)}` : 'Lượt chấm'}
      >
        {events.data && day ? (
          <EventsList data={events.data} date={day} />
        ) : events.isError ? (
          <p className="text-sm text-danger">Không tải được lượt chấm.</p>
        ) : (
          <p role="status" className="text-sm text-text-muted">
            Đang tải…
          </p>
        )}
      </Dialog>
    </PageMain>
  );
}
