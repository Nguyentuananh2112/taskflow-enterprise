import { Router, type Request, type RequestHandler, type Response } from 'express';

import { SessionRevokedError } from '../../../core/errors';
import type { HttpResponder } from '../../../core/http/envelope';
import { RATE_LIMIT_RULES, type RateLimitRule } from '../../../core/http/rate-limit/rules';
import { requireUser } from '../../../core/http/request-user';
import { requireUpload } from '../../../core/files/presentation/raw-upload';
import type { ICompanySessionGate } from '../application/ports/collaborators.port';
import type {
  RemoveAvatarUseCase,
  SetAvatarUseCase,
} from '../application/use-cases/avatar.use-cases';

export const ME_PATH = '/me';

export interface AvatarRouteDeps {
  setAvatar: Pick<SetAvatarUseCase, 'execute'>;
  removeAvatar: Pick<RemoveAvatarUseCase, 'execute'>;
  authenticate: RequestHandler;
  company: Pick<ICompanySessionGate, 'isActive'>;
  /** `rawUpload` của kho tệp với trần avatar (5 MB) — octet-stream + `X-Upload-Name`. */
  upload: RequestHandler;
  limit: (rules: readonly RateLimitRule[]) => RequestHandler[];
  responder: HttpResponder;
}

/**
 * `/api/v1/me/avatar` (ADR-142, ADR-146). Thứ tự: authenticate (401) ⇒ cổng công ty (401 `SESSION_REVOKED` — người
 * đã nghỉ / hết `access_until`) ⇒ hạn mức 10 / giờ (fail-closed) ⇒ upload nhị phân (415 / 400 / 413 / 429 / 507) ⇒
 * use case (415 / 422 / 503).
 */
export function avatarRoutes(d: AvatarRouteDeps): Router {
  const router = Router();
  const companyGate: RequestHandler = async (req, _res, next) => {
    if (!(await d.company.isActive(requireUser(req).id))) throw new SessionRevokedError();
    next();
  };
  const guarded = [d.authenticate, companyGate, ...d.limit(RATE_LIMIT_RULES.avatar)];
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.put('/avatar', ...guarded, d.upload, async (req: Request, res: Response) => {
    const { name, staged } = requireUpload(req);
    const urls = await d.setAvatar.execute({
      userId: requireUser(req).id,
      upload: {
        name,
        head: staged.head,
        sizeBytes: staged.sizeBytes,
        readAll: () => staged.readAll(),
      },
    });
    d.responder.ok(res, urls);
  });
  router.delete('/avatar', ...guarded, async (req: Request, res: Response) => {
    const userId = requireUser(req).id;
    await d.removeAvatar.execute({ userId, actorId: userId });
    res.status(204).end();
  });
  return router;
}
