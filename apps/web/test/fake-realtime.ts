import type { SocketAck } from '@taskflow/contracts/realtime';

import type { MockBoard } from '@/app/mock-api';
import type { RealtimeClient, RealtimeStatus, ServerEvent, ServerPayload } from '@/shared/socket';

// Socket giả cho test (frontend.md §8.2): hub đóng vai server Socket.io — nhận event từ mock API
// (board.onEvent, đã có `originClientId` từ header X-Client-Id) và phát vào phòng `project:{id}` cho
// các client đã join. Mỗi client giả = một tab (clientId riêng).

type Handler = (payload: never) => void;

export class FakeRealtimeHub {
  private readonly clients = new Set<FakeRealtimeClient>();
  /** Từ chối `project:join` (mô phỏng không còn là thành viên). */
  denyJoin = new Set<string>();

  constructor(board?: MockBoard) {
    board?.onEvent((event) => this.broadcast(event.room, event.name, event.payload));
  }

  client(clientId: string = crypto.randomUUID()): FakeRealtimeClient {
    const client = new FakeRealtimeClient(this, clientId);
    this.clients.add(client);
    return client;
  }

  broadcast<E extends ServerEvent>(room: string, name: E, payload: ServerPayload<E>): void {
    for (const client of this.clients) {
      if (client.status() === 'connected' && client.rooms.has(room))
        client.emitServer(name, payload);
    }
  }
}

export class FakeRealtimeClient implements RealtimeClient {
  readonly rooms = new Set<string>();
  readonly joinLog: string[] = [];
  readonly renewLog: string[] = [];
  private current: RealtimeStatus = 'offline';
  private connectedBefore = false;
  private readonly handlers = new Map<string, Set<Handler>>();
  private readonly statusListeners = new Set<(status: RealtimeStatus) => void>();
  private readonly reconnectListeners = new Set<() => void>();

  constructor(
    private readonly hub: FakeRealtimeHub,
    readonly clientId: string,
  ) {}

  connect(): void {
    if (this.current === 'connected') return;
    this.setStatus('connected');
    if (this.connectedBefore) this.reconnectListeners.forEach((l) => l());
    this.connectedBefore = true;
  }

  disconnect(): void {
    this.rooms.clear();
    this.setStatus('offline');
  }

  /** Mất mạng: server quên mọi phòng của socket này. */
  drop(): void {
    this.rooms.clear();
    this.setStatus('reconnecting');
  }

  status(): RealtimeStatus {
    return this.current;
  }

  onStatus(listener: (status: RealtimeStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => void this.statusListeners.delete(listener);
  }

  onReconnect(listener: () => void): () => void {
    this.reconnectListeners.add(listener);
    return () => void this.reconnectListeners.delete(listener);
  }

  on<E extends ServerEvent>(event: E, handler: (payload: ServerPayload<E>) => void): () => void {
    const set = this.handlers.get(event) ?? new Set<Handler>();
    set.add(handler);
    this.handlers.set(event, set);
    return () => void set.delete(handler);
  }

  /** Server phát event tới client này. */
  emitServer<E extends ServerEvent>(event: E, payload: ServerPayload<E>): void {
    this.handlers.get(event)?.forEach((handler) => (handler as (p: unknown) => void)(payload));
  }

  joinProject({ projectId }: { workspaceId: string; projectId: string }): Promise<SocketAck> {
    this.joinLog.push(projectId);
    if (this.hub.denyJoin.has(projectId)) {
      return Promise.resolve({ ok: false, code: 'RESOURCE_NOT_FOUND' });
    }
    this.rooms.add(projectId);
    return Promise.resolve({ ok: true });
  }

  leaveProject({ projectId }: { projectId: string }): Promise<SocketAck> {
    this.rooms.delete(projectId);
    return Promise.resolve({ ok: true });
  }

  renewAuth(token: string): Promise<SocketAck> {
    this.renewLog.push(token);
    return Promise.resolve({ ok: true });
  }

  private setStatus(next: RealtimeStatus): void {
    if (next === this.current) return;
    this.current = next;
    this.statusListeners.forEach((l) => l(next));
  }
}
