import * as z from 'zod';

/**
 * `GET /healthz` (devops.md §6.2): chỉ báo tiến trình còn sống, không chạm DB/Valkey. KHÔNG lộ
 * `gitSha` (T-031 Info của T-028 — gitSha nằm trong mọi dòng log); strict ⇒ thêm lại field là lỗi.
 */
export const HealthzResponse = z.strictObject({
  status: z.literal('ok'),
});
export type HealthzResponse = z.infer<typeof HealthzResponse>;
