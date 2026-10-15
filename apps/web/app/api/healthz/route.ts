import { HealthzResponse } from '@taskflow/contracts';

// Healthcheck của container web (devops.md §3.2): trả 200, không gọi API.
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(
    HealthzResponse.parse({ status: 'ok', gitSha: process.env.GIT_SHA ?? 'dev' }),
  );
}
