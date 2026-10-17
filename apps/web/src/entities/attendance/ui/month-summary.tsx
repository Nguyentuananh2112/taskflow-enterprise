import type { AttendanceTotalsDto } from '@taskflow/contracts/attendance';
import { useId } from 'react';

import { duration } from '../lib/time';

const num = (n: number) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(n);
const ddMm = (date: string) => `${Number(date.slice(8))}/${Number(date.slice(5, 7))}`;

type Props = Readonly<{ totals: AttendanceTotalsDto; title: string }>;

/**
 * Ô tổng kết tháng (T-046): số do SERVER tính (`totalsOf`, khớp bảng HR) — web không tự cộng. Chữ to, nhãn đời thường;
 * "tính đến hết ngày dd/MM" vì chỉ đếm tới hôm nay; tháng chưa tới (`throughDate = null`) ⇒ không có dòng đó.
 */
export function MonthSummary({ totals: t, title }: Props) {
  const headingId = useId();
  const items = [
    { label: 'Ngày đi làm', value: `${num(t.presentDays)} ngày` },
    { label: 'Đi muộn', value: `${num(t.lateDays)} lần` },
    { label: 'Về sớm', value: `${num(t.earlyDays)} lần` },
    { label: 'Nghỉ phép', value: `${num(t.leaveDays)} ngày` },
    { label: 'Vắng', value: `${num(t.absentDays)} ngày` },
    { label: 'Tổng giờ làm', value: t.workedMin > 0 ? duration(t.workedMin) : '0 giờ' },
  ];
  const notes = [
    t.throughDate && `Tính đến hết ngày ${ddMm(t.throughDate)}.`,
    t.missingOutDays > 0 && `Quên chấm ra: ${num(t.missingOutDays)} ngày.`,
    t.upcomingLeaveDays > 0 && `Sắp nghỉ phép: ${num(t.upcomingLeaveDays)} ngày.`,
  ].filter(Boolean);
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4 shadow-card"
    >
      <h2 id={headingId} className="text-base font-semibold">
        {title}
      </h2>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
        {items.map((i) => (
          <div key={i.label} className="flex flex-col">
            <dt className="text-sm">{i.label}</dt>
            <dd className="text-2xl font-semibold tabular-nums">{i.value}</dd>
          </div>
        ))}
      </dl>
      {notes.length > 0 && <p className="text-sm">{notes.join(' ')}</p>}
    </section>
  );
}
