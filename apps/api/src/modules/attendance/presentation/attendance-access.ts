import { IdempotencyKeyHeaders } from '@taskflow/contracts';
import type { RequestHandler } from 'express';

import { ForbiddenError, ResourceNotFoundError } from '../../../core/errors';
import { requireUser } from '../../../core/http/request-user';
import { validationErrorFromZod } from '../../../core/http/zod';

/** Quyền HIỆN TẠI (role ∪ grants, ADR-119) của người gọi; không còn là thành viên ⇒ `null`. */
export interface AttendanceMembership {
  permissionsOf(workspaceId: string, userId: string): Promise<ReadonlySet<string> | null>;
}

/**
 * Thứ tự lỗi (thiết kế §5, B-M4): 401 → 400 params → 404 không phải thành viên (ADR-020) → 403 thiếu quyền →
 * 400 body / query / header. Chạy TRƯỚC validate body ⇒ thành viên thường gửi body sai tới route `hr:manage`
 * nhận 403, không 400 (SEC-HR-02). Lệnh ghi HR còn chốt lại trong transaction (`authorizeWrite`).
 */
export function permitAttendance(
  membership: AttendanceMembership,
  permission: string,
): RequestHandler {
  return async (req, _res, next) => {
    const { wsId } = req.params as { wsId: string };
    const permissions = await membership.permissionsOf(wsId, requireUser(req).id);
    if (!permissions) throw new ResourceNotFoundError('workspace');
    if (!permissions.has(permission)) throw new ForbiddenError(permission);
    next();
  };
}

/** Header `Idempotency-Key` bắt buộc (UUID) của check-in/out — thiếu / sai ⇒ 400 (sau kiểm quyền). */
export const requireIdempotencyKey: RequestHandler = (req, _res, next) => {
  const parsed = IdempotencyKeyHeaders.safeParse(req.headers);
  next(parsed.success ? undefined : validationErrorFromZod(parsed.error));
};
