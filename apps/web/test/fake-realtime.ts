import type { SocketAck } from '@taskflow/contracts/realtime';

import type { MockBoard, MockDb } from '@/app/mock-api';
import type { RealtimeClient, RealtimeStatus, ServerEvent, ServerPayload } from '@/shared/socket';

// Socket giả cho test (frontend.md §8.2): hub đóng vai server Socket.io — nhận event từ mock API
// (board.onEvent, đã có `originClientId` từ header X-Client-Id) và phát vào phòng `project:{id}` cho
// các client đã join. Mỗi client giả = một tab (clientId riêng). Như gateway thật (security.md §5):
// client có `userId` tự vào phòng `user:{id}` khi connect; `project:join` kiểm membership + project ∈
// workspace (có `db`); `workspace:access-revoked` ⇒ rút client của user đó khỏi phòng project của ws.

type Handler = (payload: never) => void;

export class FakeRealtimeHub {
  private readonly clients = new Set<FakeRealtimeClient>();
  /** Từ chối `project:join` (mô phỏng không còn là thành viên). */
  denyJoin = new Set<string>();

  constructor(
    private readonly board?: MockBoard,
    private readonly db?: MockDb,
  ) {
    board?.onEvent((event) => this.broadcast(event.room, event.name, event.payload));
  }

  client(clientId: string = crypto.randomUUID(), userId?: string): FakeRealtimeClient {
    const client = new FakeRealtimeClient(this, clientId, userId);
    this.clients.add(client);
    return client;
  }

  /** `RESOURCE_NOT_FOUND` như server khi không còn là thành viên / ws xóa / project ∉ ws. */
  canJoin(userId: string | undefined, workspaceId: string, projectId: string): boolean {
    if (this.denyJoin.has(projectId)) return false;
    if (!this.db || !this.board || userId === undefined) return true;
    return (
      this.db.membershipIn(userId, workspaceId) !== undefined &&
      this.board.getProject(workspaceId, projectId) !== undefined
    );
  }

  broadcast<E extends ServerEvent>(room: string, name: E, payload: ServerPayload<E>): void {
    for (const client of this.clients) {
      if (client.status() === 'connected' && client.rooms.has(room))
        client.emitServer(name, payload);
    }
    // Server: socketsLeave các phòng project của ws cho user mất quyền (gateway.ts).
    if (name === 'workspace:access-revoked' && room.startsWith('user:')) {
      const { workspaceId } = (payload as { data: { workspaceId: string } }).data;
      const projectIds = this.board?.listProjects(workspaceId, 'all').map((p) => p.id) ?? [];
      for (const client of this.clients) {
        if (client.rooms.has(room)) projectIds.forEach((id) => client.rooms.delete(id));
      }
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
    readonly userId?: string,
  ) {}

  connect(): void {
    if (this.current === 'connected') return;
    if (this.userId) this.rooms.add(`user:${this.userId}`);
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

  joinProject({
    workspaceId,
    projectId,
  }: {
    workspaceId: string;
    projectId: string;
  }): Promise<SocketAck> {
    this.joinLog.push(projectId);
    if (!this.hub.canJoin(this.userId, workspaceId, projectId)) {
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
