import { AckPrivacyBody, PrivacyConsentBody, PrivacyDto } from '../privacy/privacy.schemas';
import type { ApiRoute } from './route-types';

// T-075 — thông báo quyền riêng tư (data-retention.md §5). Chính mình; cổng công ty ⇒ SESSION_REVOKED.

const base = { tag: 'auth', security: 'bearer' } as const;

export const PRIVACY_API_ROUTES: readonly ApiRoute[] = [
  {
    ...base,
    method: 'get',
    path: '/me/privacy',
    summary:
      'Thông báo quyền riêng tư: phiên bản hiện hành, lần xác nhận của tôi, đồng ý lý do nghỉ, đầu mối',
    response: { status: 200, data: PrivacyDto },
    errors: ['SESSION_REVOKED'],
  },
  {
    ...base,
    method: 'post',
    path: '/me/privacy/ack',
    summary: 'Xác nhận đã đọc phiên bản đang xem (khác bản hiện hành ⇒ 409, tải lại)',
    body: AckPrivacyBody,
    response: { status: 200, data: PrivacyDto },
    errors: ['SESSION_REVOKED', 'RESOURCE_CONFLICT'],
  },
  {
    ...base,
    method: 'put',
    path: '/me/privacy/consent',
    summary: 'Đồng ý / rút lại đồng ý xử lý lý do nghỉ (rút lại không xóa lý do cũ)',
    body: PrivacyConsentBody,
    response: { status: 200, data: PrivacyDto },
    errors: ['SESSION_REVOKED'],
  },
];
