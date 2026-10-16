'use client';

import { EventsList, dayLabel, timeOfDay } from '@/entities/attendance';
import { useHrEvents } from '@/entities/hr';
import { Button } from '@/shared/ui/button';
import { Dialog } from '@/shared/ui/dialog';
import { EmptyState } from '@/shared/ui/empty-state';
import { Skeleton } from '@/shared/ui/skeleton';

import { AddPunchForm } from './add-punch-form';
import { VoidPunchButton } from './void-punch-button';

type Props = Readonly<{
  wsId: string;
  user: Readonly<{ id: string; fullName: string }>;
  /** `null` = đóng. */
  date: string | null;
  onClose: () => void;
  /** Không tự sửa chấm công của mình (B-H1) — trừ OWNER. */
  canEdit: boolean;
}>;

const KIND = { IN: 'Vào', OUT: 'Ra' } as const;

/**
 * Lượt thô của một nhân viên trong một ngày (HR — gồm lượt đã hủy, IP/thiết bị §9) + hủy lượt + thêm
 * lượt ADJUSTMENT. Mọi chuỗi (ghi chú, lý do, UA) là TEXT — React tự escape.
 */
export function DayPunchesDialog({ wsId, user, date, onClose, canEdit }: Props) {
  const events = useHrEvents(wsId, user.id, date);
  const data = events.data;
  return (
    <Dialog
      open={date !== null}
      onOpenChange={(open) => !open && onClose()}
      title={date ? `${user.fullName} — ${dayLabel(date)}` : ''}
      className="max-w-lg"
    >
      {!date ? null : events.isError ? (
        <EmptyState
          title="Không tải được lượt chấm"
          action={<Button onClick={() => void events.refetch()}>Thử lại</Button>}
        />
      ) : !data ? (
        <Skeleton className="h-24" />
      ) : (
        <div className="flex flex-col gap-4">
          <EventsList data={data} date={date} />
          {canEdit && data.events.some((e) => e.voidedAt === null) && (
            <ul aria-label="Hủy lượt chấm" className="flex flex-col gap-2">
              {data.events
                .filter((e) => e.voidedAt === null)
                .map((e) => {
                  const label = `${KIND[e.kind]} ${timeOfDay(e.occurredAt, data.timezone, date)}`;
                  return (
                    <li key={e.id} className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="min-w-24">{label}</span>
                      <VoidPunchButton
                        wsId={wsId}
                        userId={user.id}
                        date={date}
                        eventId={e.id}
                        label={label}
                      />
                    </li>
                  );
                })}
            </ul>
          )}
          {canEdit ? (
            <AddPunchForm wsId={wsId} userId={user.id} date={date} />
          ) : (
            <p className="text-sm text-text-muted">
              Bạn không tự sửa chấm công của mình — nhờ người khác có quyền Quản lý nhân sự.
            </p>
          )}
        </div>
      )}
    </Dialog>
  );
}
