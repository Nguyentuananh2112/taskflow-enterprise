'use client';

import { useState } from 'react';

import { dayLabel } from '@/entities/attendance';
import { useHolidays } from '@/entities/hr';
import { DeleteHolidayButton, HolidayForm } from '@/features/hr-holiday-edit';
import { Button } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/empty-state';
import { Skeleton } from '@/shared/ui/skeleton';

type Props = Readonly<{ today: string; isAdmin: boolean }>;

/** Ngày lễ theo năm (HR nhập — §1). Ngày đã qua: chỉ Admin sửa/xóa (ADR-121). */
export function HolidayList({ today, isAdmin }: Props) {
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const holidays = useHolidays(year);
  return (
    <section aria-labelledby="hr-holidays" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="hr-holidays" className="text-base font-semibold">
          Ngày lễ năm {year}
        </h2>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => setYear(year - 1)}>
            ‹ {year - 1}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setYear(year + 1)}>
            {year + 1} ›
          </Button>
        </div>
      </div>
      {holidays.isError ? (
        <EmptyState
          title="Không tải được ngày lễ"
          action={<Button onClick={() => void holidays.refetch()}>Thử lại</Button>}
        />
      ) : !holidays.data ? (
        <Skeleton className="h-16" />
      ) : holidays.data.length === 0 ? (
        <p className="text-sm text-text-muted">Chưa có ngày lễ nào trong năm {year}.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border text-sm">
          {holidays.data.map((h) => {
            const past = h.date < today;
            return (
              <li key={h.date} className="flex items-center justify-between gap-3 py-2">
                <span>
                  <span className="tabular-nums">
                    {dayLabel(h.date)}/{h.date.slice(0, 4)}
                  </span>{' '}
                  · {h.name}
                </span>
                {(!past || isAdmin) && <DeleteHolidayButton holiday={h} past={past} />}
              </li>
            );
          })}
        </ul>
      )}
      <HolidayForm today={today} isAdmin={isAdmin} />
    </section>
  );
}
