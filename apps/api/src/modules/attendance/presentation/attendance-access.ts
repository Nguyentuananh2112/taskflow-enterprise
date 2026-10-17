import { IdempotencyKeyHeaders } from '@taskflow/contracts';
import type { RequestHandler } from 'express';

import { ForbiddenError, SessionRevokedError } from '../../../core/errors';
import { requireUser } from '../../../core/http/request-user';
import { validationErrorFromZod } from '../../../core/http/zod';

/**
 * Quyền công ty HIỆN TẠI của người gọi (role ∪ grants — company-level ADR-135); không còn thuộc công ty hoặc đã
 * quá `access_until` ⇒ `null`. Adapter ở composition root (module company — một truy vấn, không cache).
 */
export interface AttendanceCompanyMembership {
  permissionsOf(userId: string): Promise<ReadonlySet<string> | null>;
}

/**
 * Thứ tự lỗi (company-level ADR-135): 401 → không thuộc công ty / hết `access_until` ⇒ 401 `SESSION_REVOKED` →
 * thiếu MỌI quyền trong `anyOf` ⇒ 403 → 400 params / body / query / header. Chạy TRƯỚC validate ⇒ nhân viên gửi body
 * sai tới route `hr:manage` nhận 403, không 400 (SEC-HR-02). Lệnh ghi HR còn chốt lại trong transaction
 * (`authorizeWrite`); lệnh chấm của nhân viên chốt lại sau khóa (`assertActiveEmployee`).
 */
export function permitCompany(
  membership: AttendanceCompanyMembership,
  anyOf: readonly string[],
): RequestHandler {
  return async (req, _res, next) => {
    const permissions = await membership.permissionsOf(requireUser(req).id);
    if (!permissions) throw new SessionRevokedError();
    if (!anyOf.some((p) => permissions.has(p))) throw new ForbiddenError(anyOf.join(' | '));
    next();
  };
}

/** Header `Idempotency-Key` bắt buộc (UUID) của check-in/out — thiếu / sai ⇒ 400 (sau kiểm quyền). */
export const requireIdempotencyKey: RequestHandler = (req, _res, next) => {
  const parsed = IdempotencyKeyHeaders.safeParse(req.headers);
  next(parsed.success ? undefined : validationErrorFromZod(parsed.error));
};
