import type { IClock, IIdGenerator } from '../../../core/domain';
import { requestContext } from '../../../core/context/request-context';
import { HR_AUDIT_FORBIDDEN_KEYS, type HrAuditAction } from '../domain/hr-audit';
import type { AuditValue, IHrAuditLog } from './ports/hr-audit.port';

export interface HrAuditInput {
  /** null = `admin:bootstrap` (CLI). */
  actorId: string | null;
  action: HrAuditAction;
  targetUserId?: string | null;
  refId?: string | null;
  before?: AuditValue;
  after?: AuditValue;
}

/**
 * Ghi HrAuditLog TRONG transaction của bên gọi (cùng `uow.run`). Từ chối `before` / `after` có khóa
 * cấm (B-H2: `reason` của đơn nghỉ) — lỗi lập trình, ném ngay để test bắt được, không ghi gì.
 */
export class HrAuditWriter {
  constructor(private readonly d: { hrAudit: IHrAuditLog; ids: IIdGenerator; clock: IClock }) {}

  async record(input: HrAuditInput): Promise<void> {
    for (const value of [input.before, input.after]) {
      for (const key of HR_AUDIT_FORBIDDEN_KEYS) {
        if (value && key in value) {
          throw new Error(`HrAuditLog không được chứa '${key}' (B-H2 — dữ liệu nhạy cảm)`);
        }
      }
    }
    await this.d.hrAudit.append({
      id: this.d.ids.next(),
      actorId: input.actorId,
      action: input.action,
      targetUserId: input.targetUserId ?? null,
      refId: input.refId ?? null,
      before: input.before ?? null,
      after: input.after ?? null,
      requestId: requestContext.requestId() ?? null,
      createdAt: this.d.clock.now(),
    });
  }
}
