'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/shared/ui/button';

import { session } from '../model/session';

type Props = Readonly<{
  /** `SessionState.retryAt` — mốc được thử lại. */
  retryAt: number;
  /** Câu thêm theo ngữ cảnh (vd /activate: đừng tải lại trang). */
  hint?: string;
}>;

/**
 * Khôi phục phiên bị 429 (lỗi #5): KHÔNG phải mất mạng — báo "thao tác quá nhanh", đếm ngược theo `retryAfterSec` và tự
 * thử lại khi hết giờ; nút "Thử lại" mở khi hết giờ. Số giây chỉ hiện bằng chữ (không aria-live mỗi giây).
 */
export function RateLimitedRetry({ retryAt, hint }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= retryAt) {
        clearInterval(id);
        void session.bootstrap();
      }
    }, 250);
    return () => clearInterval(id);
  }, [retryAt]);
  const remaining = Math.max(0, Math.ceil((retryAt - now) / 1000));
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <p className="text-lg font-semibold">Bạn thao tác quá nhanh</p>
      <p className="text-sm text-text-muted">
        Máy chủ đang tạm giới hạn số lần thử.{' '}
        {remaining > 0 ? `Tự thử lại sau ${String(remaining)} giây.` : 'Đang thử lại…'} Phiên đăng
        nhập của bạn vẫn được giữ.
      </p>
      {hint && <p className="text-sm">{hint}</p>}
      <Button disabled={remaining > 0} onClick={() => void session.bootstrap()}>
        Thử lại
      </Button>
    </div>
  );
}
