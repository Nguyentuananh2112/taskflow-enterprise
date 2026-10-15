// Healthcheck (liveness) của container web (devops.md §3.2): trả 200, không gọi API. KHÔNG lộ gitSha
// ra công khai (như API ở T-031 — phiên bản đã có trong mọi dòng log). Không cache.
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } });
}
