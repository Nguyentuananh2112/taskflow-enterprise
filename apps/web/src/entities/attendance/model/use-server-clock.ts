import { useEffect, useState } from 'react';

import { serverOffsetMs } from '../lib/time';

/**
 * Giờ hiện tại THEO SERVER, nhảy mỗi giây: độ lệch = `serverNow` − thời điểm nhận response
 * (`receivedAtMs` = `dataUpdatedAt` của query). Không tin giờ máy (attendance-leave.md §5).
 */
export function useServerClock(serverNow: string | undefined, receivedAtMs: number): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!serverNow) return null;
  // `now` có thể lấy TRƯỚC khi response về (state lúc mount) ⇒ không để đồng hồ lùi sau giờ nhận.
  return Math.max(now, receivedAtMs) + serverOffsetMs(serverNow, receivedAtMs);
}
