import type { IClock } from '../domain';
import {
  AUTH_RENEW_LIMIT,
  MAX_SOCKETS_PER_USER,
  PROJECT_JOIN_LIMIT_PER_USER,
} from '../http/rate-limit/rules';
import { SlidingWindow } from '../http/rate-limit/sliding-window';

/**
 * Hạn mức chống lạm dụng theo USER của realtime (ADR-115): số socket, `project:join`/phút,
 * `auth:renew`/phút. Không phải kiểm quyền — quyền vẫn kiểm ở handshake/join/renew, thu hồi vẫn
 * fail-closed (ADR-105).
 *
 * - `LocalRealtimeQuota`: đếm trong instance (v1, 1 instance) — luôn chạy.
 * - `SharedRealtimeQuota` (`shared-quota.ts`): bọc bản Local, đếm thêm dùng chung qua Valkey khi
 *   `SOCKET_REDIS_ADAPTER=true` (> 1 instance); Valkey lỗi ⇒ chỉ còn hạn mức Local.
 */
export interface IRealtimeQuota {
  /** Gateway gọi một lần: nguồn số socket THẬT theo user trên instance này (đồng bộ lại định kỳ). */
  start(localCounts: () => ReadonlyMap<string, number>): void;
  tryJoin(userId: string): Promise<boolean>;
  tryRenew(userId: string): Promise<boolean>;
  /**
   * Giữ một suất socket cho user TRƯỚC khi nhận kết nối. `localCount` = số socket user đang có trên
   * instance này (gateway đếm theo phòng user). `false` ⇒ từ chối `RATE_LIMITED`.
   */
  acquireSocket(userId: string, localCount: number): Promise<boolean>;
  /** Trả suất khi socket đã nhận (acquire thành công) ngắt kết nối. Không bao giờ ném. */
  releaseSocket(userId: string): Promise<void>;
  /** Tắt êm: dừng heartbeat, gỡ phần đếm của instance này (best-effort). */
  close(): Promise<void>;
}

export class LocalRealtimeQuota implements IRealtimeQuota {
  readonly #renews = new SlidingWindow(AUTH_RENEW_LIMIT.user);
  readonly #joins = new SlidingWindow(PROJECT_JOIN_LIMIT_PER_USER);

  constructor(private readonly clock: IClock) {}

  start(): void {}

  tryJoin(userId: string): Promise<boolean> {
    return Promise.resolve(this.#joins.tryHit(userId, this.clock.now().getTime()));
  }

  tryRenew(userId: string): Promise<boolean> {
    return Promise.resolve(this.#renews.tryHit(userId, this.clock.now().getTime()));
  }

  acquireSocket(_userId: string, localCount: number): Promise<boolean> {
    return Promise.resolve(localCount < MAX_SOCKETS_PER_USER);
  }

  releaseSocket(): Promise<void> {
    return Promise.resolve();
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}
