import * as z from 'zod';

/** `GET /healthz` (devops.md §6.2): chỉ báo tiến trình còn sống, không chạm DB/Valkey. */
export const HealthzResponse = z.strictObject({
  status: z.literal('ok'),
  gitSha: z.string().min(1),
});
export type HealthzResponse = z.infer<typeof HealthzResponse>;
