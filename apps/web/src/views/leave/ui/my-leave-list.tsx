import { LEAVE_STATUS, LEAVE_TYPE_NAME, canCancel, daysText, leaveRange } from '@/entities/leave';
import { CancelLeaveButton } from '@/features/leave-cancel';
import type { LeaveRequestDto } from '@/shared/api/m3-provisional';
import { cn } from '@/shared/lib/cn';

type Props = Readonly<{ wsId: string; requests: readonly LeaveRequestDto[]; today: string }>;

/** Đơn của tôi, mới nhất trước. Trạng thái bằng chữ + biểu tượng; lý do / ghi chú HR là TEXT. */
export function MyLeaveList({ wsId, requests, today }: Props) {
  if (requests.length === 0) {
    return <p className="text-sm text-text-muted">Bạn chưa gửi đơn nghỉ nào.</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {requests.map((r) => {
        const s = LEAVE_STATUS[r.status];
        return (
          <li
            key={r.id}
            className="flex flex-wrap items-start gap-x-4 gap-y-1 rounded-card border border-border bg-surface p-3 text-sm"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <p className="font-medium">
                {LEAVE_TYPE_NAME[r.type]} · {leaveRange(r)} · {daysText(r.days)}
              </p>
              <p className={cn(s.tone)}>
                <span aria-hidden="true">{s.icon} </span>
                {s.label}
                {r.decidedBy && <span className="text-text-muted"> · {r.decidedBy.fullName}</span>}
              </p>
              {r.reason && <p className="break-words text-text-muted">Lý do: {r.reason}</p>}
              {r.decisionNote && (
                <p className="break-words text-text-muted">Ghi chú của HR: {r.decisionNote}</p>
              )}
            </div>
            {canCancel(r, today) && <CancelLeaveButton wsId={wsId} request={r} />}
          </li>
        );
      })}
    </ul>
  );
}
