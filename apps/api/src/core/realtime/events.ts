import type { SocketAck } from '@taskflow/contracts';
import * as z from 'zod';

import type { IClock, IIdGenerator } from '../domain';
import type { RealtimeEventMeta } from './ports';

// Hợp đồng WebSocket (data-and-api §4) — schema payload & ack lấy từ contracts (T-010).
export { AuthRenewPayload, ProjectJoinPayload, ProjectLeavePayload } from '@taskflow/contracts';

/** `clientId` theo tab — không hợp lệ ⇒ coi như null (security §5.2). */
export const ClientId = z.uuid().nullable().catch(null);

export type { SocketAck };
export type AckFn = (ack: SocketAck) => void;

/** Vỏ chung mọi event server → client (data-and-api §4.3). */
export interface RealtimeEnvelope<TType extends string = string, TData = unknown> {
  eventId: string;
  type: TType;
  occurredAt: string;
  actorId: string;
  originClientId: string | null;
  data: TData;
}

export interface ClientToServerEvents {
  'project:join': (payload: unknown, ack: AckFn) => void;
  'project:leave': (payload: unknown, ack: AckFn) => void;
  'auth:renew': (payload: unknown, ack: AckFn) => void;
}

export type ServerToClientEvents = Record<string, (event: RealtimeEnvelope) => void>;

/**
 * Server ↔ server (`serverSideEmit` qua redis-adapter) — không bao giờ tới client. Rời phòng project
 * theo workspace dựa trên `data.joined` của từng socket (review B G1: `projectIds` là ảnh chụp trong
 * tx ⇒ thiếu project tạo/join song song). `userId: null` ⇒ mọi socket (workspace bị xóa).
 */
export interface InterServerEvents {
  'workspace:leave-rooms': (input: { workspaceId: string; userId: string | null }) => void;
}

export interface SocketData {
  userId: string;
  sid: string;
  expiresAt: Date;
  clientId: string | null;
  /** projectId → workspaceId của các phòng đang join. */
  joined: Map<string, string>;
}

export const rooms = {
  user: (userId: string) => `user:${userId}`,
  session: (sid: string) => `session:${sid}`,
  project: (projectId: string) => `project:${projectId}`,
  /**
   * Mốc 6 (ADR-142): MỌI socket đã xác thực LẠI thành công (`joinPersonalRooms`) — một công ty ⇒ = mọi nhân viên đang
   * hoạt động. Chỉ cho dữ liệu danh bạ (`user:avatar-changed` — R49).
   */
  company: () => 'company',
};

/** Tạo vỏ event: `eventId` uuid v7, `occurredAt` = thời điểm phát (sau commit). */
export function createEnvelope<TType extends string, TData>(
  deps: { ids: IIdGenerator; clock: IClock },
  type: TType,
  data: TData,
  meta: RealtimeEventMeta,
): RealtimeEnvelope<TType, TData> {
  return {
    eventId: deps.ids.next(),
    type,
    occurredAt: deps.clock.now().toISOString(),
    actorId: meta.actorId,
    originClientId: meta.originClientId ?? null,
    data,
  };
}
