import type { EmployeeDto } from '@taskflow/contracts/company';

import { EMPLOYEE_STATUS_LABEL, MISSING_HIRE_DATE, hireDateLine } from '@/entities/company';
import { EmployeeActions } from '@/features/employee-manage';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';

const dmy = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

type Props = Readonly<{
  employee: EmployeeDto;
  /** Chưa có hôm nay của server ⇒ chưa có nút (hộp cần ngày mặc định / giới hạn). */
  ready: boolean;
  locked: boolean;
  /** Thẻ của chính người xem: luật self tuyệt đối (ADR-128) — không "Sửa hồ sơ". */
  self: boolean;
  onOpen: (kind: 'offboard' | 'rehire' | 'profile', employee: EmployeeDto) => void;
}>;

/** Một nhân viên: tên + trạng thái (chữ, không chỉ màu), email, ngày vào / ngày làm cuối, MỘT nút theo trạng thái. */
export function EmployeeRow({ employee: e, ready, locked, self, onOpen }: Props) {
  const dates =
    e.status === 'LEFT'
      ? e.offboardLastDay && `Làm tới ${dmy(e.offboardLastDay)}`
      : [
          e.startDate && `Vào làm ${dmy(e.startDate)}`,
          e.offboardLastDay && `làm tới hết ${dmy(e.offboardLastDay)}`,
        ]
          .filter(Boolean)
          .join(' · ');
  const work = [e.department, e.jobTitle].filter(Boolean).join(' · ');
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
        {work && <p className="text-sm">{work}</p>}
        {e.missingHireDate ? (
          <p className="text-sm text-warning">
            <span aria-hidden="true">⚠ </span>
            {MISSING_HIRE_DATE}
          </p>
        ) : (
          <p className="text-sm text-text-muted">{hireDateLine(e.hireDate, e.seniority)}</p>
        )}
        {dates && <p className="text-sm text-text-muted">{dates}</p>}
      </div>
      {ready && (
        <div className="flex flex-wrap items-center gap-2">
          {self ? (
            <p className="text-xs text-text-muted">Hồ sơ của bạn do HR khác hoặc Admin sửa</p>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Sửa hồ sơ của ${e.fullName}`}
              onClick={() => onOpen('profile', e)}
            >
              Sửa hồ sơ
            </Button>
          )}
          <EmployeeActions employee={e} locked={locked} onOpen={onOpen} />
        </div>
      )}
    </li>
  );
}
