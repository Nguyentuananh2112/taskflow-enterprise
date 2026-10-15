import { HealthzResponse } from '@taskflow/contracts';

// Healthcheck của container web (devops.md §3.2): trả 200, không gọi API, không lộ gitSha.
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(HealthzResponse.parse({ status: 'ok' }));
}
