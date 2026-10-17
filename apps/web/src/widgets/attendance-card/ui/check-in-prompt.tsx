'use client';

import {
  callName,
  greetingAt,
  minuteOfDay,
  minutesToClock,
  timeOfDay,
  useAttendanceToday,
} from '@/entities/attendance';
import { useSession } from '@/entities/session';
import { newCheckKey, useAttendanceCheck } from '@/features/attendance-check';
import { Button } from '@/shared/ui/button';
import { Dialog } from '@/shared/ui/dialog';

import { useCheckInPrompt } from '../model/use-check-in-prompt';

type Props = Readonly<{ wsId: string; enabled: boolean }>;

/**
 * Dialog nhắc chấm công khi vào trang dự án (T-045): chỉ khi `me/today` của server cho thấy hôm nay phải chấm mà chưa
 * chấm; tối đa 1 lần / ngày. "Để sau" / Esc / bấm nền ⇒ đóng. KHÔNG tự chấm.
 */
export function CheckInPrompt({ wsId, enabled }: Props) {
  const { user } = useSession();
  const today = useAttendanceToday(wsId, enabled);
  const t = today.data;
  const { open, close } = useCheckInPrompt(wsId, user?.id ?? null, t, today.dataUpdatedAt);
  const check = useAttendanceCheck(wsId, {
    successTitle: (d) =>
      d.firstIn ? `Đã chấm vào lúc ${timeOfDay(d.firstIn, d.timezone)}` : 'Đã chấm vào',
  });
  if (!open || !t?.schedule) return null;
  const name = user ? callName(user.fullName) : null;
  const minute = minuteOfDay(Date.parse(t.serverNow), t.timezone);
  return (
    <Dialog
      open
      onOpenChange={(next) => !next && close()}
      title={`${greetingAt(minute)}${name ? `, ${name}` : ''}!`}
      description="Hôm nay bạn chưa chấm công."
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Để sau
          </Button>
          <Button
            // Nút chính nhận focus khi mở (Radix giữ focus đã có trong dialog) — Enter là chấm luôn.
            autoFocus
            loading={check.isPending}
            onClick={() => check.mutate({ kind: 'IN', key: newCheckKey() }, { onSettled: close })}
          >
            Chấm công vào
          </Button>
        </>
      }
    >
      <p className="text-sm">
        Ca làm hôm nay:{' '}
        <strong className="tabular-nums">
          {minutesToClock(t.schedule.startMin)}–{minutesToClock(t.schedule.endMin)}
        </strong>
      </p>
    </Dialog>
  );
}
