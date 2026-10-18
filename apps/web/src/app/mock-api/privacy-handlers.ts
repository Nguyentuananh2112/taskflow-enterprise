import { AckPrivacyBody, PrivacyConsentBody, PrivacyDto } from '@taskflow/contracts/privacy';
import { http, type HttpHandler } from 'msw';

import type { MockDb } from './mock-db';
import { requireCompany } from './mock-guard';
import { fail, ok, parseBody } from './respond';

// T-075 (G, contracts e01c5c85): `GET /me/privacy`, `POST /me/privacy/ack {version}` (khác bản hiện hành ⇒ 409
// RESOURCE_CONFLICT `privacy_version_outdated`), `PUT /me/privacy/consent {leaveReason}`. Mọi người thuộc công ty — kể
// cả Admin.

export function createPrivacyHandlers(baseUrl: string, db: MockDb): HttpHandler[] {
  const company = db.company;
  const dto = (userId: string) => company.privacy.toDto(userId, company);
  return [
    http.get(`${baseUrl}/me/privacy`, ({ request }) => {
      const ctx = requireCompany(request, db);
      if (ctx.response) return ctx.response;
      return ok(PrivacyDto, dto(ctx.ok.user.id));
    }),
    http.post(`${baseUrl}/me/privacy/ack`, async ({ request }) => {
      const ctx = requireCompany(request, db);
      if (ctx.response) return ctx.response;
      const body = await parseBody(request, AckPrivacyBody);
      if (body.response) return body.response;
      if (body.data.version !== company.privacy.version) {
        return fail(409, 'RESOURCE_CONFLICT', { reason: 'privacy_version_outdated' });
      }
      company.privacy.ack(ctx.ok.user.id);
      return ok(PrivacyDto, dto(ctx.ok.user.id));
    }),
    http.put(`${baseUrl}/me/privacy/consent`, async ({ request }) => {
      const ctx = requireCompany(request, db);
      if (ctx.response) return ctx.response;
      const body = await parseBody(request, PrivacyConsentBody);
      if (body.response) return body.response;
      company.privacy.setConsent(ctx.ok.user.id, body.data.leaveReason);
      return ok(PrivacyDto, dto(ctx.ok.user.id));
    }),
  ];
}
