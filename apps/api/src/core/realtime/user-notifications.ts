import { rooms } from './events';
import type { CompanyGrant, CompanyRole, RealtimeEventMeta } from './ports';

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

  /**
   * Mốc 3.5 (thay `member:grants-changed`): role / grants CÔNG TY của user đổi ⇒ web làm mới `['company']` ngay.
   * CHỈ `{ role, grants }`; REST vẫn kiểm quyền mỗi request.
   */
  companyAccessChanged(
    input: { userId: string; role: CompanyRole; grants: readonly CompanyGrant[] },
    meta: RealtimeEventMeta,
  ): Promise<void> {
    const { userId, role, grants } = input;
    this.#emit(rooms.user(userId), 'company:access-changed', { role, grants: [...grants] }, meta);
    return Promise.resolve();
  }

  /**
   * ADR-123 (T-040): thông báo bền đã commit ⇒ báo người nhận. CHỈ id + loại — nội dung
   * (tên, ngày nghỉ) dựng lúc đọc theo quyền hiện tại (B-H3b).
   */
  notification(
    input: { recipientId: string; notificationId: string; type: string },
    meta: RealtimeEventMeta,
  ): Promise<void> {
    const { recipientId, notificationId, type } = input;
    this.#emit(rooms.user(recipientId), 'notification:new', { notificationId, type }, meta);
    return Promise.resolve();
  }
}
