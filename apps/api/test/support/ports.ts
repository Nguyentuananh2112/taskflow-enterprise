import { createServer } from 'node:net';

/**
 * Dải cổng cho process/container test tự bật (F5). NGOÀI dải ephemeral của cả Windows (49152–65535)
 * lẫn Linux (32768–60999): `listen(0)` trả cổng ephemeral — đúng dải mà kết nối ĐI RA (trình duyệt,
 * telemetry…) lấy làm cổng nguồn ⇒ giữa lúc "chọn" và lúc API listen trên `::`, một kết nối ra ngoài
 * có thể chiếm đúng cổng đó (EADDRINUSE :::51644 đo được 2026-10-16). Cổng trong dải này chỉ còn va với
 * một listener khác chủ động chọn cùng dải — tức lượt test khác (đã có khóa run theo DB/Valkey).
 */
export const TEST_PORT_MIN = 20_000;
export const TEST_PORT_MAX = 29_999;
const MAX_ATTEMPTS = 50;

/** Cổng trống (thử bind trên cả `::` và `127.0.0.1`) trong [TEST_PORT_MIN, TEST_PORT_MAX]. */
export async function availablePort(random: () => number = Math.random): Promise<number> {
  const span = TEST_PORT_MAX - TEST_PORT_MIN + 1;
  const tried: number[] = [];
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const port = TEST_PORT_MIN + Math.floor(random() * span);
    tried.push(port);
    if ((await canBind(port, '::')) && (await canBind(port, '127.0.0.1'))) return port;
  }
  throw new Error(
    `Không tìm được cổng trống trong ${String(TEST_PORT_MIN)}–${String(TEST_PORT_MAX)} sau ${String(MAX_ATTEMPTS)} lần (đã thử: ${tried.join(', ')})`,
  );
}

function canBind(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', (err: NodeJS.ErrnoException) => {
      // Máy không có IPv6 ⇒ không thể có ai chiếm cổng đó trên `::`.
      resolve(err.code === 'EADDRNOTAVAIL' || err.code === 'EAFNOSUPPORT');
    });
    server.listen({ port, host, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}
