'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

import {
  MonthCalendar,
  MonthSummary,
  MonthTable,
  shiftMonth,
  useAttendanceMonth,
  useAttendanceToday,
} from '@/entities/attendance';
import { useCompanyPermission } from '@/entities/session';
import { Button } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/empty-state';
import { PageMain } from '@/shared/ui/page';
import { Skeleton } from '@/shared/ui/skeleton';

import { useViewMode } from '../model/use-view-mode';
import { DayDetail } from './day-detail';
import { TodayBox } from './today-box';
import { ViewToggle } from './view-toggle';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const monthTitle = (m: string) => `tháng ${Number(m.slice(5))}/${m.slice(0, 4)}`;

/**
 * `/attendance?month=YYYY-MM` — bảng công tháng của tôi (attendance-leave.md §6), cấp CÔNG TY (ADR-139): thẻ chấm công
 * đầy đủ nằm ở đây, trang chính chỉ có thẻ gọn. Admin không phải nhân viên ⇒ không có bảng công.
 */
export function AttendancePage() {
  const { company, can } = useCompanyPermission();
  const allowed = can('attendance:self');
  const today = useAttendanceToday(allowed);
  const asked = useSearchParams().get('month');
  // Tháng mặc định = tháng của "hôm nay" THEO SERVER (múi giờ của lịch), không theo máy.
  const month = asked && MONTH.test(asked) ? asked : today.data?.date.slice(0, 7);
  const data = useAttendanceMonth(month ?? '', allowed && month !== undefined);
  const [day, setDay] = useState<string | null>(null);
  const [mode, setMode] = useViewMode();
  const t = today.data;
  const serverToday = t?.date ?? '';

  if (company !== null && !allowed) {
    return (
      <main className="mx-auto max-w-md px-4 py-16">
        <EmptyState
          title="Tài khoản Quản trị không chấm công"
          action={
            <Link href="/w" className="text-sm underline">
              Về trang chính
            </Link>
          }
        />
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
      {month === undefined && today.isError ? (
        // Không có ?month và chưa biết "hôm nay" của server ⇒ báo lỗi thay vì kẹt skeleton.
        <EmptyState
          title="Không tải được bảng công"
          action={<Button onClick={() => void today.refetch()}>Thử lại</Button>}
        />
      ) : data.isError ? (
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
        <>
          {t && month === serverToday.slice(0, 7) && <TodayBox today={t} />}
          <MonthSummary totals={data.data.totals} title={`Tổng kết ${monthTitle(month)}`} />
          <ViewToggle mode={mode} onChange={setMode} />
          {mode === 'calendar' ? (
            <MonthCalendar
              month={data.data}
              caption={`Bảng công ${monthTitle(month)}`}
              today={serverToday}
              onSelectDay={setDay}
            />
          ) : (
            <MonthTable
              month={data.data}
              caption={`Bảng công ${monthTitle(month)}`}
              onSelectDay={setDay}
              today={serverToday}
            />
          )}
        </>
      )}
      <DayDetail
        day={data.data?.days.find((d) => d.date === day) ?? null}
        days={data.data?.days ?? []}
        today={serverToday}
        onSelectDay={setDay}
        onClose={() => setDay(null)}
      />
    </PageMain>
  );
}
