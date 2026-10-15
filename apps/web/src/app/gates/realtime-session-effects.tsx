'use client';

import { useRealtimeSession } from '@/features/realtime-session';

/** Lắng nghe sự kiện realtime cấp ứng dụng trong khu đã đăng nhập (frontend.md §3.5). */
export function RealtimeSessionEffects() {
  useRealtimeSession();
  return null;
}
