import type { RequestHandler, Router } from 'express';

import type { IClock } from '../core/domain';
import type { HttpResponder } from '../core/http/envelope';
import type { RateLimitRule } from '../core/http/rate-limit/rules';
import { PrivacyUseCases } from '../modules/auth/application/use-cases/privacy.use-cases';
import { PRIVACY_PATH, privacyRoutes } from '../modules/auth/presentation/privacy.routes';
import type { Persistence } from './persistence';

/**
 * T-075 — thông báo quyền riêng tư. Dữ liệu ở `users` (auth); bên kiểm soát + đầu mối đọc dòng `companies` (company)
 * — nối ở đây, không thêm phụ thuộc chéo giữa module.
 */
export function privacyRouters(x: {
  persistence: Pick<Persistence, 'auth' | 'company' | 'uow'>;
  auth: { authenticate: RequestHandler };
  company: { sessionGate: { isActive(userId: string): Promise<boolean> } };
  responder: HttpResponder;
  limit: (rules: readonly RateLimitRule[]) => RequestHandler[];
  clock: IClock;
}): { path: string; router: Router }[] {
  const { persistence } = x;
  const privacy = new PrivacyUseCases({
    store: persistence.auth.privacy,
    company: {
      async info() {
        const c = await persistence.company.company.get();
        return c && { name: c.name, privacyContact: c.privacyContact };
      },
    },
    uow: persistence.uow,
    clock: x.clock,
  });
  const router = privacyRoutes({
    privacy,
    authenticate: x.auth.authenticate,
    isCompanyActive: (id) => x.company.sessionGate.isActive(id),
    limit: x.limit,
    responder: x.responder,
  });
  return [{ path: PRIVACY_PATH, router }];
}
