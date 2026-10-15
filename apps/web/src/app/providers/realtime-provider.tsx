'use client';

import { useEffect, useMemo, type ReactNode } from 'react';

import { session, useSession } from '@/entities/session';
import { getRuntimeConfig } from '@/shared/config';
import { getClientId } from '@/shared/lib/client-id';
import {
  RealtimeClientProvider,
  createOfflineRealtimeClient,
  createSocketIoClient,
  type RealtimeClient,
} from '@/shared/socket';

export type RealtimeClientFactory = () => RealtimeClient;

const OFFLINE = createOfflineRealtimeClient(getClientId());

const socketFactory: RealtimeClientFactory = () => {
  const { apiUrl, wsUrl } = getRuntimeConfig();
  // Mock API dev (APP_MOCK_API=1, route Next cùng origin — T-019) không có Socket.io: board vẫn dùng
  // được qua REST, header báo "Mất kết nối thời gian thực" thay vì thử kết nối mãi.
  if (new URL(apiUrl).pathname.startsWith('/mock-api/')) return OFFLINE;
  return createSocketIoClient({ url: wsUrl, clientId: getClientId(), auth: session.realtimeAuth });
};

/**
 * Một kết nối socket cho mỗi phiên (frontend.md §3.5): tạo SAU khi đăng nhập, hủy khi phiên kết
 * thúc. Có token mới ⇒ `auth:renew`; tab hiện lại mà socket không nối ⇒ ép `connect()`.
 */
export function RealtimeProvider({
  children,
  createClient = socketFactory,
}: Readonly<{ children: ReactNode; createClient?: RealtimeClientFactory }>) {
  const authenticated = useSession().status === 'authenticated';
  // `io(…, { autoConnect: false })` không mở kết nối khi tạo — connect ở effect bên dưới.
  const client = useMemo(
    () => (authenticated ? createClient() : OFFLINE),
    [authenticated, createClient],
  );

  useEffect(() => {
    if (client === OFFLINE) return;
    client.connect();
    const offRenew = session.realtimeAuth.onTokenRenewed(() => {
      const token = session.realtimeAuth.token();
      // ack.ok=false ⇒ server tự ngắt ⇒ nhánh disconnect của client refresh + nối lại.
      if (token && client.status() === 'connected') void client.renewAuth(token);
    });
    const onVisible = () => {
      if (document.visibilityState === 'visible' && client.status() !== 'connected') {
        client.connect();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      offRenew();
      document.removeEventListener('visibilitychange', onVisible);
      client.disconnect();
    };
  }, [client]);

  return <RealtimeClientProvider client={client}>{children}</RealtimeClientProvider>;
}
