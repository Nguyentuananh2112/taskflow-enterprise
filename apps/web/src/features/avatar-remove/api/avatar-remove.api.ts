import * as z from 'zod';

import { http } from '@/shared/api';

/** `DELETE /hr/employees/:userId/avatar` (ADR-142) — `hr:manage`; Admin / người giữ grant chỉ Admin gỡ; không tự gỡ. */
export const removeAvatarOf = (userId: string) =>
  http.delete(`/hr/employees/${userId}/avatar`, { schema: z.undefined() });
