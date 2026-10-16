import { startTransition, useEffect, useState } from 'react';

/** Số thẻ mỗi cột hiện NGAY ở lần render đầu (đủ phủ màn hình cao nhất). */
export const FIRST_BATCH = 40;
/** Mỗi lô thêm sau đó — render trong transition (React nhường main thread giữa các lô). */
export const NEXT_BATCH = 60;

/**
 * Mount dần board lớn (perf/board-mount bậc 3): mỗi cột hiện `limit` thẻ đầu, `limit` tăng theo lô
 * trong `startTransition` tới khi ≥ cột dài nhất rồi CHỐT `Infinity` — từ đó thẻ mới (realtime / tạo)
 * hiện ngay, không mount dần lại. Board nhỏ (≤ FIRST_BATCH/cột) ⇒ `Infinity` ngay từ đầu.
 */
export function useProgressiveLimit(longestColumn: number): number {
  const [limit, setLimit] = useState(() =>
    longestColumn <= FIRST_BATCH ? Number.POSITIVE_INFINITY : FIRST_BATCH,
  );
  useEffect(() => {
    if (limit === Number.POSITIVE_INFINITY) return;
    // Đã phủ cột dài nhất ⇒ chốt Infinity; chưa ⇒ thêm một lô. Cả hai trong transition (không chặn).
    startTransition(() =>
      setLimit((current) =>
        current >= longestColumn ? Number.POSITIVE_INFINITY : current + NEXT_BATCH,
      ),
    );
  }, [limit, longestColumn]);
  return limit;
}
