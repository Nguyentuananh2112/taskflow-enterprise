import type { RequestHandler } from 'express';

import type { IClock, IIdGenerator } from '../core/domain';
import { DEFAULT_EXPORT_LIMITS, type ExportLimits } from '../core/export/export-limits';
import { ExportSlots } from '../core/export/export-slots';
import { FflateXlsxWriter } from '../core/export/xlsx/xlsx-writer';
import type { HttpResponder } from '../core/http/envelope';
import type { RateLimitRule } from '../core/http/rate-limit/rules';
import {
  createAttendanceModule,
  type AttendanceModule,
} from '../modules/attendance/attendance.module';
import type { ApprovedLeavePort } from '../modules/attendance/application/ports/approved-leave.port';
import type { CompanyModule } from '../modules/company/company.module';
import type { NotificationsModule } from '../modules/notifications/notifications.module';
import { attendanceNotifierFrom } from './notification-adapters';
import type { Persistence } from './persistence';

// Adapter nối module attendance với module khác qua port do attendance sở hữu (ADR-093) — chỉ composition root biết
// cả hai phía. Mốc 3.5 (company-level ADR-136, T-063): quyền / nhiệm kỳ / audit HR đều từ module company.

/**
 * `ApprovedLeavePort` gắn TRỄ: leave ↔ attendance phụ thuộc vòng (leave cần lịch của attendance) ⇒ attendance dựng
 * trước, leave gắn vào sau bằng `bind`. TẠM (T-061 loại leave khỏi build — `tsconfig.exclusions.json`): chưa gắn ⇒
 * không có đơn nghỉ nào; D gắn leave ở T-064 (cổng gộp `feat/company-level` đòi danh sách loại rỗng).
 */
export class LateApprovedLeavePort implements ApprovedLeavePort {
  #port: ApprovedLeavePort | undefined;

  bind(port: ApprovedLeavePort): void {
    this.#port = port;
  }

  approvedLeaves(q: Parameters<ApprovedLeavePort['approvedLeaves']>[0]) {
    return this.#port ? this.#port.approvedLeaves(q) : Promise.resolve([]);
  }
}

/**
 * Hai đối tượng dùng chung dựng ở container TRƯỚC attendance: đơn nghỉ gắn trễ + suất export của CẢ công ty (2 đồng thời —
 * SEC-HR-54; báo cáo chấm công và báo cáo phép — T-057 — dùng cùng instance `exportSlots`).
 */
export function attendanceShared() {
  return { approvedLeaves: new LateApprovedLeavePort(), exportSlots: new ExportSlots() };
}

/**
 * Module attendance với adapter thật: quyền + nhiệm kỳ + audit HR ← company (tham chiếu trễ), thông báo ←
 * notifications, đơn nghỉ ← leave (gắn trễ), mốc lưu ← job retention (T-047; thiếu ⇒ không áp), tên ← task/auth.
 * `clock` = giờ NGHIỆP VỤ (TEST_CLOCK_ANCHOR ở E2E).
 */
export function wireAttendance(
  d: {
    persistence: Pick<Persistence, 'attendance' | 'task' | 'uow'>;
    ids: IIdGenerator;
    clock: IClock;
    retentionCutoff?: (() => string | null) | undefined;
  },
  m: {
    company: () => Pick<CompanyModule, 'access' | 'tenures' | 'hrAudit' | 'permissionsOf'>;
    notifications: Pick<NotificationsModule, 'publisher'>;
    leaves: ApprovedLeavePort;
  },
  http: {
    responder: HttpResponder;
    limit: (rules: readonly RateLimitRule[]) => RequestHandler[];
    /** Xuất .xlsx (T-055): trần + nhịp đọc (thiếu ⇒ mặc định) và suất export DÙNG CHUNG của container. */
    exports: { limits?: ExportLimits | undefined; slots: ExportSlots };
  },
): AttendanceModule {
  return createAttendanceModule({
    repos: d.persistence.attendance,
    leaves: m.leaves,
    tenures: { tenuresOf: (q) => m.company().tenures.tenuresOf(q) },
    retention: { recordsCutoffDate: d.retentionCutoff ?? (() => null) },
    users: d.persistence.task.users,
    company: {
      authorizeWrite: (q) => m.company().access.authorizeWrite(q),
      isEmployee: (userId) => m.company().access.isEmployee(userId),
      assertActiveEmployee: (userId) => m.company().access.assertActiveEmployee(userId),
    },
    audit: { record: (entry) => m.company().hrAudit.record(entry) },
    notifier: attendanceNotifierFrom(m.notifications.publisher),
    membership: { permissionsOf: (userId) => m.company().permissionsOf(userId) },
    uow: d.persistence.uow,
    exports: {
      snapshot: d.persistence.uow.snapshot,
      slots: http.exports.slots,
      limits: http.exports.limits ?? DEFAULT_EXPORT_LIMITS,
      writer: new FflateXlsxWriter(),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    },
    clock: d.clock,
    ids: d.ids,
    responder: http.responder,
    limit: http.limit,
  });
}
