'use client';

import { useState } from 'react';

import { duration, shiftMonth } from '@/entities/attendance';
import { useTimesheet } from '@/entities/hr';
import { daysText } from '@/entities/leave';
import { ExportCsvButton } from '@/features/hr-export-csv';
import { Button } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/empty-state';
import { Skeleton } from '@/shared/ui/skeleton';

import { PersonMonth } from './person-month';

type Props = Readonly<{ wsId: string; today: string; isOwner: boolean; viewerId: string | null }>;

const COLUMNS = ['Giờ làm', 'Đi muộn', 'Về sớm', 'Vắng', 'Nghỉ phép', 'Chưa chấm ra'] as const;
const monthTitle = (m: string) => `tháng ${Number(m.slice(5))}/${m.slice(0, 4)}`;

/**
 * Tab "Bảng công tháng" (§5–§6): dòng tổng mỗi người (50 người/trang, cursor) + xuất CSV; chọn một người
 * ⇒ lịch tháng của người đó (bấm ngày ⇒ lượt thô, thêm/hủy lượt). Người đã rời có dữ liệu vẫn hiện (R30).
 */
export function HrTimesheet({ wsId, today, isOwner, viewerId }: Props) {
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState<string | null>(null);
  const sheet = useTimesheet(wsId, month);
  const rows = sheet.data?.pages.flatMap((p) => p.data) ?? [];
  const person = rows.find((r) => r.user.id === selected);
  return (
    <section aria-labelledby="hr-timesheet" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="hr-timesheet" className="text-base font-semibold">
          Bảng công {monthTitle(month)}
        </h2>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => setMonth(shiftMonth(month, -1))}>
            ‹ Tháng trước
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={month >= today.slice(0, 7)}
            onClick={() => setMonth(shiftMonth(month, 1))}
          >
            Tháng sau ›
          </Button>
          <ExportCsvButton wsId={wsId} month={month} />
        </div>
      </div>
      {sheet.isError ? (
        <EmptyState
          title="Không tải được bảng công"
          action={<Button onClick={() => void sheet.refetch()}>Thử lại</Button>}
        />
      ) : sheet.isPending ? (
        <Skeleton className="h-48" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-text-muted">Chưa có nhân viên nào.</p>
      ) : (
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[44rem] border-collapse text-sm">
            <caption className="sr-only">Tổng hợp công {monthTitle(month)} theo nhân viên</caption>
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
              </tr>
            </thead>
            <tbody>
              {rows.map(({ user, left, totals: t }) => (
                <tr key={user.id} className="border-b border-border tabular-nums">
                  <th scope="row" className="py-2 pr-3 text-left font-normal">
                    <button
                      type="button"
                      aria-pressed={selected === user.id}
                      onClick={() => setSelected(selected === user.id ? null : user.id)}
                      className="text-left font-medium text-primary hover:underline"
                    >
                      {user.fullName}
                    </button>
                    {left && <span className="text-text-muted"> (đã rời)</span>}
                  </th>
                  <td className="py-2 pr-3">{t.workedMin > 0 ? duration(t.workedMin) : '—'}</td>
                  <td className="py-2 pr-3">
                    {t.lateDays > 0 ? `${t.lateDays} lần · ${duration(t.lateMin)}` : '—'}
                  </td>
                  <td className="py-2 pr-3">
                    {t.earlyDays > 0 ? `${t.earlyDays} lần · ${duration(t.earlyMin)}` : '—'}
                  </td>
                  <td className="py-2 pr-3">{t.absentDays > 0 ? daysText(t.absentDays) : '—'}</td>
                  <td className="py-2 pr-3">{t.leaveDays > 0 ? daysText(t.leaveDays) : '—'}</td>
                  <td className="py-2 pr-3">{t.missingOutDays > 0 ? t.missingOutDays : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {sheet.hasNextPage && (
        <Button
          variant="secondary"
          className="self-center"
          loading={sheet.isFetchingNextPage}
          onClick={() => void sheet.fetchNextPage()}
        >
          Tải thêm
        </Button>
      )}
      {person && (
        <PersonMonth
          wsId={wsId}
          month={month}
          row={person}
          today={today}
          canEdit={isOwner || person.user.id !== viewerId}
        />
      )}
    </section>
  );
}
