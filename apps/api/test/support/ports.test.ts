// F5: helper chọn cổng cho process/container test tự bật — ngoài dải ephemeral, bỏ qua cổng đã bị chiếm.
import { createServer, type Server } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { TEST_PORT_MAX, TEST_PORT_MIN, availablePort } from './ports';

const SPAN = TEST_PORT_MAX - TEST_PORT_MIN + 1;
const at = (port: number) => (port - TEST_PORT_MIN + 0.5) / SPAN; // random() ⇒ đúng cổng này

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

function occupy(port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen({ port, host, exclusive: true }, () => {
      servers.push(server);
      resolve();
    });
  });
}

describe('availablePort (F5)', () => {
  it('trả cổng trong dải test, ngoài dải ephemeral của Windows (49152+) và Linux (32768+)', async () => {
    const port = await availablePort();
    expect(port).toBeGreaterThanOrEqual(TEST_PORT_MIN);
    expect(port).toBeLessThanOrEqual(TEST_PORT_MAX);
    expect(TEST_PORT_MAX).toBeLessThan(32_768);
  });

  it('cổng đang bị chiếm trên 127.0.0.1 ⇒ bỏ qua, lấy số kế tiếp', async () => {
    const busy = await availablePort();
    await occupy(busy, '127.0.0.1');
    const free = await availablePort();
    const seq = [at(busy), at(free)];
    expect(await availablePort(() => seq.shift() ?? 0)).toBe(free);
  });

  it('hết số lần thử ⇒ lỗi nêu dải và các cổng đã thử', async () => {
    const busy = await availablePort();
    await occupy(busy, '127.0.0.1');
    await expect(availablePort(() => at(busy))).rejects.toThrow(
      new RegExp(`${String(TEST_PORT_MIN)}–${String(TEST_PORT_MAX)}.*${String(busy)}`),
    );
  });
});
