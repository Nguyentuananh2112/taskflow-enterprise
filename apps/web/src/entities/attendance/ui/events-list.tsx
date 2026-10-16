import type { AttendanceEventsDto } from '@taskflow/contracts/attendance';

import { cn } from '@/shared/lib/cn';

import { timeOfDay } from '../lib/time';

const KIND = { IN: 'Vào', OUT: 'Ra' } as const;
const SOURCE = { WEB: 'Web', DEVICE: 'Máy chấm công', ADJUSTMENT: 'HR điều chỉnh' } as const;

type Props = Readonly<{ data: AttendanceEventsDto; date: string }>;

/**
 * Lượt chấm của một ngày (log bất biến — ADR-121): lượt ĐÃ HỦY vẫn hiện, gạch ngang + người hủy + lý
 * do, để nhân viên hiểu vì sao bảng công đổi. IP / thiết bị là dữ liệu của chính họ (NĐ 13 Đ.14).
 * Mọi chuỗi (ghi chú, lý do, UA) là TEXT — React tự escape (E2E-HR-08).
 */
export function EventsList({ data, date }: Props) {
  if (data.events.length === 0) {
    return <p className="text-sm text-text-muted">Không có lượt chấm nào trong ngày này.</p>;
  }
  return (
    <ol className="flex flex-col gap-3 text-sm">
      {data.events.map((e) => {
        const voided = e.voidedAt !== null;
        return (
          <li key={e.id} className="flex flex-col gap-0.5 rounded-control border border-border p-3">
            <p className={cn('font-medium', voided && 'text-text-muted line-through')}>
              {KIND[e.kind]} lúc {timeOfDay(e.occurredAt, data.timezone, date)} · {SOURCE[e.source]}
            </p>
            {voided && (
              <p className="text-danger">
                Đã hủy{e.voidedBy ? ` bởi ${e.voidedBy.fullName}` : ''}
                {e.voidReason ? `: ${e.voidReason}` : ''}
              </p>
            )}
            {e.source === 'ADJUSTMENT' && (
              <p className="text-text-muted">
                Thêm bởi {e.createdBy.fullName}
                {e.note ? `: ${e.note}` : ''}
              </p>
            )}
            {(e.ip || e.userAgent) && (
              <p className="text-xs break-all text-text-muted">
                {e.ip && <>IP {e.ip}</>}
                {e.ip && e.userAgent && ' · '}
                {e.userAgent && <>Thiết bị: {e.userAgent}</>}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
