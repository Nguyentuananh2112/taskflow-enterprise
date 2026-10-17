import type { Request, RequestHandler } from 'express';

import { ForbiddenError, SessionRevokedError } from '../../../core/errors';
import { requireUser } from '../../../core/http/request-user';
import type { ILeaveCompany } from '../application/ports/leave.ports';

/**
 * Thứ tự lỗi HTTP (company-level ADR-135): 401 (chưa đăng nhập / không còn thuộc công ty ⇒ `SESSION_REVOKED`) →
 * 400 params → 403 thiếu quyền → 400 body/query. `permit` chạy TRƯỚC validate body/query ⇒ thành viên thường gửi body sai tới
 * route `hr:manage` nhận 403, không 400 (SEC-HR-02). Use case vẫn kiểm lại trong transaction (B-H3).
 */
export function permitLeave(
  company: Pick<ILeaveCompany, 'reloadActor'>,
  permission: string | ((req: Request) => string),
): RequestHandler {
  return async (req, _res, next) => {
    const actor = await company.reloadActor(requireUser(req).id);
    if (!actor) throw new SessionRevokedError();
    const required = typeof permission === 'string' ? permission : permission(req);
    if (!actor.permissions.has(required)) throw new ForbiddenError(required);
    next();
  };
}

/** `GET leave/requests`: `?mine=1` ⇒ `leave:self`, còn lại (cả công ty) ⇒ `hr:manage` — đọc query THÔ trước validate. */
export const listPermission = (req: Request): string =>
  (req.query as Record<string, unknown>).mine === '1' ? 'leave:self' : 'hr:manage';
