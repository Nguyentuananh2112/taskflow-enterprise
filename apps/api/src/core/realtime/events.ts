import * as z from 'zod';

import type { IClock, IIdGenerator } from '../domain';
import type { ErrorCode } from '../errors';
import type { RealtimeEventMeta } from './ports';

// Hợp đồng WebSocket (data-and-api §4). TODO(T-010 merge): thay bằng schema/kiểu trong
// `@taskflow/contracts/realtime` (REALTIME_EVENTS, SocketAck, *Payload) — cùng hình dạng.

const Uuid = z.uuid();
export const ProjectJoinPayload = z.strictObject({ workspaceId: Uuid, projectId: Uuid });
export const ProjectLeavePayload = z.strictObject({ projectId: Uuid });
export const AuthRenewPayload = z.strictObject({ token: z.string().min(1) });
/** `clientId` theo tab — không hợp lệ ⇒ coi như null (security §5.2). */
export const ClientId = Uuid.nullable().catch(null);

export type SocketAck = { ok: true } | { ok: false; code: ErrorCode };
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
