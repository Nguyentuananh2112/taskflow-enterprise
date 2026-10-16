import { rooms } from './events';
import type { MemberGrant, RealtimeEventMeta } from './ports';

type Emit = (room: string, type: string, data: unknown, meta: RealtimeEventMeta) => void;

/**
 * Event Mốc 3 tới phòng `user:{id}` (tách khỏi `gateway.ts` để giữ file gọn — max-lines). Gateway
 * truyền hàm phát của nó vào; payload tối thiểu (SEC-HR-20), REST vẫn kiểm quyền mỗi request.
 */
export class UserNotifications {
  readonly #emit: Emit;

  constructor(emit: Emit) {
    this.#emit = emit;
  }

  /** ADR-119: grant của user đổi ⇒ web làm mới quyền ngay. CHỈ `{ workspaceId, grants }`. */
  grantsChanged(
    input: { userId: string; workspaceId: string; grants: readonly MemberGrant[] },
    meta: RealtimeEventMeta,
  ): Promise<void> {
    const { userId, workspaceId, grants } = input;
    this.#emit(
      rooms.user(userId),
      'member:grants-changed',
      { workspaceId, grants: [...grants] },
      meta,
    );
    return Promise.resolve();
  }

  /**
   * ADR-123 (T-040): thông báo bền đã commit ⇒ báo người nhận. CHỈ id + loại + workspace — nội dung
   * (tên, ngày nghỉ) dựng lúc đọc theo quyền hiện tại (B-H3b).
   */
  notification(
    input: { recipientId: string; notificationId: string; type: string; workspaceId: string },
    meta: RealtimeEventMeta,
  ): Promise<void> {
    const { recipientId, notificationId, type, workspaceId } = input;
    this.#emit(
      rooms.user(recipientId),
      'notification:new',
      { notificationId, type, workspaceId },
      meta,
    );
    return Promise.resolve();
  }
}
