import type { EmployeeDto } from '@taskflow/contracts/company';

import { EMPLOYEE_STATUS_LABEL } from '@/entities/company';
import { EmployeeActions } from '@/features/employee-manage';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';

const dmy = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

type Props = Readonly<{
  employee: EmployeeDto;
  /** Chưa có hôm nay của server ⇒ chưa có nút (hộp cần ngày mặc định / giới hạn). */
  ready: boolean;
  locked: boolean;
  onOpen: (kind: 'offboard' | 'rehire', employee: EmployeeDto) => void;
  /** Dòng của chính người đang xem. */
  self: boolean;
  /** Mốc 6 (ADR-142): mở dialog gỡ ảnh ở CẤP TRANG (E12). */
  onRemoveAvatar: (employee: EmployeeDto) => void;
}>;

/** Một nhân viên: tên + trạng thái (chữ, không chỉ màu), email, ngày vào / ngày làm cuối, MỘT nút theo trạng thái. */
export function EmployeeRow({ employee: e, ready, locked, self, onOpen, onRemoveAvatar }: Props) {
  // SEC-CH-17: không tự gỡ qua route HR; người giữ grant chỉ Admin gỡ (`locked`); chờ kích hoạt / đã nghỉ không có ảnh.
  const canRemoveAvatar = !self && !locked && (e.status === 'ACTIVE' || e.status === 'OFFBOARDING');
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
      {canRemoveAvatar && (
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Gỡ ảnh đại diện ${e.fullName}`}
          onClick={() => onRemoveAvatar(e)}
        >
          Gỡ ảnh đại diện
        </Button>
      )}
      {ready && <EmployeeActions employee={e} locked={locked} onOpen={onOpen} />}
    </li>
  );
}
