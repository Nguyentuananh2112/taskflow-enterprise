'use client';

import { useChatRealtime } from '@/features/chat-realtime';
import { useRealtimeSession } from '@/features/realtime-session';

/** Lắng nghe sự kiện realtime cấp ứng dụng trong khu đã đăng nhập (frontend.md §3.5) + trò chuyện (Mốc 6). */
export function RealtimeSessionEffects() {
  useRealtimeSession();
  useChatRealtime();
  return null;
}
