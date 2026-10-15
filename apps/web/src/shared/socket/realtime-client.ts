import type {
  ProjectJoinPayload,
  ProjectLeavePayload,
  ServerToClientEvents,
  SocketAck,
} from '@taskflow/contracts/realtime';

// Interface socket mà phần còn lại của app dùng (frontend.md §8.2): test tiêm bản giả, prod dùng
// socket.io. Kênh CHỈ ĐỌC — mọi ghi đi qua REST (security.md §5).

export type RealtimeStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline';

export type ServerEvent = keyof ServerToClientEvents;
export type ServerPayload<E extends ServerEvent> = Parameters<ServerToClientEvents[E]>[0];

export interface RealtimeClient {
  /** `X-Client-Id` của tab (bỏ event do chính tab gây ra — data-and-api §4.4-1). */
  readonly clientId: string;
  connect(): void;
  disconnect(): void;
  status(): RealtimeStatus;
  onStatus(listener: (status: RealtimeStatus) => void): () => void;
  /** Kết nối lại thành công (lần `connect` thứ 2 trở đi) ⇒ join lại phòng + refetch 1 lần (§4.5). */
  onReconnect(listener: () => void): () => void;
  on<E extends ServerEvent>(event: E, handler: (payload: ServerPayload<E>) => void): () => void;
  joinProject(payload: ProjectJoinPayload): Promise<SocketAck>;
  leaveProject(payload: ProjectLeavePayload): Promise<SocketAck>;
  renewAuth(token: string): Promise<SocketAck>;
}

/** Client không làm gì — trước khi đăng nhập, hoặc khi không có socket (mock dev). */
export function createOfflineRealtimeClient(clientId: string): RealtimeClient {
  const none = () => () => undefined;
  const ack = () => Promise.resolve<SocketAck>({ ok: false, code: 'SERVICE_UNAVAILABLE' });
  return {
    clientId,
    connect: () => undefined,
    disconnect: () => undefined,
    status: () => 'offline',
    onStatus: none,
    onReconnect: none,
    on: none,
    joinProject: ack,
    leaveProject: ack,
    renewAuth: ack,
  };
}
