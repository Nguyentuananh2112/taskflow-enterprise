'use client';

import { createContext, use, useSyncExternalStore, type ReactNode } from 'react';

import { getClientId } from '@/shared/lib/client-id';

import {
  createOfflineRealtimeClient,
  type RealtimeClient,
  type RealtimeStatus,
} from './realtime-client';

// Context mang RealtimeClient xuống các feature (board-realtime, realtime-session). Provider thật
// (tạo socket sau khi đăng nhập) ở src/app/providers; test tiêm FakeRealtimeClient.

const OFFLINE = createOfflineRealtimeClient(getClientId());
const RealtimeContext = createContext<RealtimeClient>(OFFLINE);

export function RealtimeClientProvider({
  client,
  children,
}: Readonly<{ client: RealtimeClient; children: ReactNode }>) {
  return <RealtimeContext value={client}>{children}</RealtimeContext>;
}

export function useRealtimeClient(): RealtimeClient {
  return use(RealtimeContext);
}

/** Trạng thái kết nối cho header (chấm màu + chữ — frontend.md §3.5). */
export function useRealtimeStatus(): RealtimeStatus {
  const client = useRealtimeClient();
  return useSyncExternalStore(
    (onChange) => client.onStatus(onChange),
    () => client.status(),
    () => 'offline',
  );
}
