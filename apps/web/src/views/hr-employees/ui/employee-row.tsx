import type { EmployeeDto } from '@taskflow/contracts/company';

import { EMPLOYEE_STATUS_LABEL } from '@/entities/company';
import { EmployeeActions } from '@/features/employee-manage';
import { Badge } from '@/shared/ui/badge';

const dmy = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

type Props = Readonly<{ employee: EmployeeDto; today: string | null; locked: boolean }>;

/** Một nhân viên: tên + trạng thái (chữ, không chỉ màu), email, ngày vào / ngày làm cuối, MỘT nút theo trạng thái. */
export function EmployeeRow({ employee: e, today, locked }: Props) {
  const dates =
    e.status === 'LEFT'
      ? e.offboardLastDay && `Làm tới ${dmy(e.offboardLastDay)}`
      : [
          e.startDate && `Vào làm ${dmy(e.startDate)}`,
          e.offboardLastDay && `làm tới hết ${dmy(e.offboardLastDay)}`,
        ]
          .filter(Boolean)
          .join(' · ');
  return (
    <li
      aria-label={e.fullName}
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border border-border bg-surface p-4"
    >
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 font-medium">
          {e.fullName}
          <Badge>{EMPLOYEE_STATUS_LABEL[e.status]}</Badge>
        </p>
        <p className="truncate text-sm text-text-muted">{e.email}</p>
        {dates && <p className="text-sm text-text-muted">{dates}</p>}
      </div>
      {today && <EmployeeActions employee={e} today={today} locked={locked} />}
    </li>
  );
}
