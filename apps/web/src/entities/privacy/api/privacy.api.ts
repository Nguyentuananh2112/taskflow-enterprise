import { PrivacyDto } from '@taskflow/contracts/privacy';

import { http } from '@/shared/api';

/** T-075 (G): thông báo quyền riêng tư của chính mình — mọi người thuộc công ty (kể cả Admin). */
export const privacyApi = {
  me: () => http.get('/me/privacy', { schema: PrivacyDto }),
  /** `version` = phiên bản đang hiển thị; server đã có bản mới ⇒ 409 RESOURCE_CONFLICT `privacy_version_outdated`. */
  ack: (version: number) => http.post('/me/privacy/ack', { schema: PrivacyDto, body: { version } }),
  consent: (leaveReason: boolean) =>
    http.put('/me/privacy/consent', { schema: PrivacyDto, body: { leaveReason } }),
};
