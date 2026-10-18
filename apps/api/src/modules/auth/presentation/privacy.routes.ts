import { AckPrivacyBody, PrivacyConsentBody } from '@taskflow/contracts';
import { Router, type Request, type RequestHandler, type Response } from 'express';

import { SessionRevokedError } from '../../../core/errors';
import type { HttpResponder } from '../../../core/http/envelope';
import { RATE_LIMIT_RULES, type RateLimitRule } from '../../../core/http/rate-limit/rules';
import { requireUser } from '../../../core/http/request-user';
import { validate } from '../../../core/http/validate';
import type { PrivacyUseCases } from '../application/use-cases/privacy.use-cases';

export const PRIVACY_PATH = '/me/privacy';

/**
 * `/api/v1/me/privacy` (T-075). authenticate (401) ⇒ cổng công ty (401 SESSION_REVOKED — người đã nghỉ / hết
 * `access_until`) ⇒ hạn mức chung ⇒ validate (400). Dữ liệu của chính mình ⇒ `no-store`.
 */
export function privacyRoutes(d: {
  privacy: PrivacyUseCases;
  authenticate: RequestHandler;
  isCompanyActive(userId: string): Promise<boolean>;
  limit: (rules: readonly RateLimitRule[]) => RequestHandler[];
  responder: HttpResponder;
}): Router {
  const router = Router();
  const companyGate: RequestHandler = async (req, _res, next) => {
    if (!(await d.isCompanyActive(requireUser(req).id))) throw new SessionRevokedError();
    next();
  };
  router.use(d.authenticate, companyGate, ...d.limit(RATE_LIMIT_RULES.authenticated));
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.get('/', async (req: Request, res: Response) => {
    d.responder.ok(res, await d.privacy.get(requireUser(req).id));
  });
  router.post('/ack', validate({ body: AckPrivacyBody }), async (req: Request, res: Response) => {
    const { version } = req.body as AckPrivacyBody;
    d.responder.ok(res, await d.privacy.ack(requireUser(req).id, version));
  });
  router.put(
    '/consent',
    validate({ body: PrivacyConsentBody }),
    async (req: Request, res: Response) => {
      const { leaveReason } = req.body as PrivacyConsentBody;
      d.responder.ok(res, await d.privacy.setLeaveReasonConsent(requireUser(req).id, leaveReason));
    },
  );
  return router;
}
