import type { HrAuditAction } from '../../domain/hr-audit';

export type AuditValue = Readonly<Record<string, unknown>> | null;

export interface HrAuditEntry {
  id: string;
  /** null = `admin:bootstrap` (CLI — không có người). */
  actorId: string | null;
  action: HrAuditAction;
  targetUserId: string | null;
  refId: string | null;
  before: AuditValue;
  after: AuditValue;
  requestId: string | null;
  createdAt: Date;
}

export interface HrAuditRow extends HrAuditEntry {
  actorName: string | null;
}

export interface AuditPage {
  items: HrAuditRow[];
  nextAfter: string | null;
}

/**
 * Nhật ký thao tác nhân sự cấp công ty — CHỈ THÊM. `append` chạy bằng client của transaction hiện hành
 * (`uow.db()`) ⇒ gọi TRONG `uow.run` của bên gọi: audit commit / rollback cùng thay đổi. Module attendance /
 * leave / payroll nhận bản này qua composition root (ADR-093, khớp cấu trúc).
 */
export interface IHrAuditLog {
  append(entry: HrAuditEntry): Promise<void>;
  /** Mới nhất trước: (createdAt, id) giảm dần, keyset theo `after` = id của dòng cuối trang trước. */
  list(page: { after?: string | undefined; limit: number }): Promise<AuditPage>;
}
