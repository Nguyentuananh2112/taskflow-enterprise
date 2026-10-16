import type { HrAuditAction } from '../../domain/hr-audit';
import type { Page, PageRequest } from './queries.port';

export type AuditValue = Readonly<Record<string, unknown>> | null;

export interface HrAuditEntry {
  id: string;
  workspaceId: string;
  actorId: string;
  action: HrAuditAction;
  targetUserId: string | null;
  refId: string | null;
  before: AuditValue;
  after: AuditValue;
  requestId: string | null;
  createdAt: Date;
}

export interface HrAuditRow extends HrAuditEntry {
  actorName: string;
}

/**
 * Nhật ký thao tác nhân sự — CHỈ THÊM (như TaskAuditLog). `append` chạy bằng client của transaction
 * hiện hành (`uow.db()`), nên gọi TRONG `uow.run` của bên gọi: audit commit / rollback cùng thay đổi.
 * Module attendance / leave (T-038 / T-039) nhận bản này qua composition root (ADR-093, khớp cấu trúc).
 */
export interface IHrAuditLog {
  append(entry: HrAuditEntry): Promise<void>;
  /** Mới nhất trước: (createdAt, id) giảm dần, keyset theo `after` = id của dòng cuối trang trước. */
  list(workspaceId: string, page: PageRequest): Promise<Page<HrAuditRow>>;
}
