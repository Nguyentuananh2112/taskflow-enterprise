import type { AttendanceTodayDto } from '@taskflow/contracts/attendance';
import { useCallback, useEffect, useState } from 'react';

import { shouldPromptCheckIn, useServerClock } from '@/entities/attendance';

import { promptMemory } from './prompt-memory';

type Decision = Readonly<{ date: string; open: boolean }>;

/**
 * Quyết định MỘT lần cho mỗi `workDate` khi `me/today` về (giờ server = `serverNow` + thời gian trôi). Mở ⇒ ghi "đã
 * hiện" ngay ⇒ tải lại trang / vào lại trang dự án trong ngày không hiện nữa (T-045).
 */
export function useCheckInPrompt(
  wsId: string,
  userId: string | null,
  today: AttendanceTodayDto | undefined,
  receivedAt: number,
) {
  const nowMs = useServerClock(today?.serverNow, receivedAt);
  const [decision, setDecision] = useState<Decision | null>(null);
  // Điều chỉnh state trong lúc render (không qua effect) — chỉ khi có ngày mới chưa quyết định.
  if (today && userId && nowMs !== null && decision?.date !== today.date) {
    const open = !promptMemory.seen(userId, wsId, today.date) && shouldPromptCheckIn(today, nowMs);
    setDecision({ date: today.date, open });
  }
  useEffect(() => {
    if (decision?.open && userId) promptMemory.mark(userId, wsId, decision.date);
  }, [decision, userId, wsId]);
  const close = useCallback(() => setDecision((d) => (d ? { date: d.date, open: false } : d)), []);
  return { open: decision?.open ?? false, close };
}
