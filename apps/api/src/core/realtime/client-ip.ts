import type { IncomingMessage } from 'node:http';

/** IP client sau `TRUST_PROXY_HOPS` proxy tin cậy (cùng quy tắc `trust proxy` của Express). */
export function clientIp(req: IncomingMessage, trustProxyHops: number): string {
  const forwarded = String(req.headers['x-forwarded-for'] ?? '')
    .split(',')
    .map((ip) => ip.trim())
    .filter(Boolean);
  const chain = [...forwarded, req.socket.remoteAddress ?? ''];
  return chain[Math.max(0, chain.length - 1 - trustProxyHops)] ?? '';
}
