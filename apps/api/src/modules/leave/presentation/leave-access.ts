import type { Request, RequestHandler } from 'express';

import { ForbiddenError, ResourceNotFoundError } from '../../../core/errors';
import { requireUser } from '../../../core/http/request-user';
import type { ILeaveMembership } from '../application/ports/leave.ports';

/**
 * Thứ tự lỗi HTTP (thiết kế §5 "Thứ tự lỗi", B-M4): 401 → 400 params → 404 không phải thành viên ws (ADR-020) →
 * 403 thiếu quyền → 400 body/query. `permit` chạy TRƯỚC validate body/query ⇒ thành viên thường gửi body sai tới
 * route `hr:manage` nhận 403, không 400 (SEC-HR-02). Use case vẫn kiểm lại trong transaction (B-H3).
 */
export function permitLeave(
  membership: Pick<ILeaveMembership, 'reloadActor'>,
  permission: string | ((req: Request) => string),
): RequestHandler {
  return async (req, _res, next) => {
    const { wsId } = req.params as { wsId: string };
    const actor = await membership.reloadActor(wsId, requireUser(req).id);
    if (!actor) throw new ResourceNotFoundError('workspace');
    const required = typeof permission === 'string' ? permission : permission(req);
    if (!actor.permissions.has(required)) throw new ForbiddenError(required);
    next();
  };
}

/** `GET leave-requests`: `?mine=1` ⇒ `leave:self`, còn lại (danh sách cả ws) ⇒ `hr:manage` — đọc query THÔ trước validate. */
export const listPermission = (req: Request): string =>
  (req.query as Record<string, unknown>).mine === '1' ? 'leave:self' : 'hr:manage';
