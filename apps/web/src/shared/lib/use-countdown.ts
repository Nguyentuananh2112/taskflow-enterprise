import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Đếm ngược theo giây (vd `retryAfterSec` của `RATE_LIMITED` — frontend.md §1.2). Tính theo mốc kết thúc
 * (`Date.now()`) nên không trôi khi tab chạy nền làm chậm `setInterval`. `onEnd` chạy MỘT lần khi đếm
 * về 0 (gọi từ timer, không phải thân effect).
 */
export function useCountdown(onEnd?: () => void) {
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const onEndRef = useRef(onEnd);
  useEffect(() => {
    onEndRef.current = onEnd;
  });

  useEffect(() => {
    if (endsAt === null) return;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t < endsAt) return;
      setEndsAt(null);
      onEndRef.current?.();
    }, 250);
    return () => clearInterval(id);
  }, [endsAt]);

  const start = useCallback((seconds: number) => {
    const t = Date.now();
    setNow(t);
    setEndsAt(t + seconds * 1000);
  }, []);

  const remaining = endsAt === null ? 0 : Math.max(0, Math.ceil((endsAt - now) / 1000));
  return { remaining, start };
}
