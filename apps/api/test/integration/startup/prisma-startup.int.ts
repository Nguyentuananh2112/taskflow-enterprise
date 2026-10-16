// T-020 (quyết định Tech Lead): khởi động `src/main.ts` THẬT với Prisma + Valkey thật — chứng minh wiring
// composition root, không gọi createApp trực tiếp. Và staging/production + module bộ nhớ ⇒ từ chối khởi động.
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { productionEnvVars, testEnvVars } from '../../support';
import { availablePort } from '../../support/ports';
import { testDatabaseUrl } from '../db';
import {
  disconnectTestPrisma,
  resetDatabase,
  testPrisma,
  testValkeyUrl,
} from '../support/prisma-test-kit';
import { stopChildren } from '../support/child-process';

const API_DIR = resolve(import.meta.dirname, '../../..');
// F5: ngoài dải ephemeral + kiểm trống (trước: 4600+random không kiểm).
const PORT = await availablePort();
const PORT_GUARD = await availablePort();
const BASE = `http://127.0.0.1:${PORT}`;
const STARTUP_TIMEOUT_MS = 120_000;

function startApi(env: NodeJS.ProcessEnv): {
  child: ChildProcess;
  output: () => string;
  exited: Promise<number | null>;
} {
  let output = '';
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
    cwd: API_DIR,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (b: Buffer) => (output += b.toString()));
  child.stderr?.on('data', (b: Buffer) => (output += b.toString()));
  const exited = new Promise<number | null>((r) => child.once('exit', (code) => r(code)));
  return { child, output: () => output, exited };
}

async function waitHealthy(api: ReturnType<typeof startApi>): Promise<void> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  let exitCode: number | null | undefined;
  void api.exited.then((code) => (exitCode = code));
  while (Date.now() < deadline && exitCode === undefined) {
    const ok = await fetch(`${BASE}/healthz`).then(
      (r) => r.ok,
      () => false,
    );
    if (ok) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`API không lên /healthz kịp (exit=${String(exitCode)}):\n${api.output()}`);
}

const children: ChildProcess[] = [];
afterAll(async () => {
  // Chờ API con thoát hẳn TRƯỚC khi file kế tiếp TRUNCATE / FLUSHDB (nó còn giữ kết nối).
  await stopChildren(children);
  await disconnectTestPrisma();
});

describe('Khởi động main.ts với Prisma + Valkey thật (T-020)', () => {
  it(
    'PERSISTENCE=prisma: readyz xanh; register → login → me → logout-all qua HTTP; dữ liệu nằm trong Postgres',
    async () => {
      await resetDatabase();
      const api = startApi(
        testEnvVars({
          PORT: String(PORT),
          DATABASE_URL: testDatabaseUrl(),
          REDIS_URL: testValkeyUrl(),
          PERSISTENCE: 'prisma',
        }),
      );
      children.push(api.child);
      await waitHealthy(api);
      expect((await fetch(`${BASE}/readyz`)).status).toBe(200);

      const email = `startup-${randomUUID()}@example.com`;
      const json = { 'content-type': 'application/json' };
      const reg = await fetch(`${BASE}/api/v1/auth/register`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ email, password: 'correct-horse-12', fullName: 'Startup Test' }),
      });
      expect(reg.status).toBe(201);
      const login = await fetch(`${BASE}/api/v1/auth/login`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ email, password: 'correct-horse-12' }),
      });
      expect(login.status).toBe(200);
      const { data } = (await login.json()) as { data: { accessToken: string } };
      const auth = { authorization: `Bearer ${data.accessToken}` };
      expect((await fetch(`${BASE}/api/v1/auth/me`, { headers: auth })).status).toBe(200);
      expect(
        (
          await fetch(`${BASE}/api/v1/auth/logout-all`, {
            method: 'POST',
            headers: { ...auth, ...json },
          })
        ).status,
      ).toBe(204);
      expect((await fetch(`${BASE}/api/v1/auth/me`, { headers: auth })).status).toBe(401);

      const row = await testPrisma().user.findUniqueOrThrow({
        where: { email },
        select: { tokenVersion: true },
      });
      expect(row.tokenVersion).toBe(1); // ghi thật vào Postgres, không phải bộ nhớ
      expect(await testPrisma().workspace.count()).toBe(1); // workspace mặc định của register
      expect(api.output()).not.toContain('persistence.in_memory_data_lost_on_restart');
    },
    STARTUP_TIMEOUT_MS + 30_000,
  );

  it(
    'staging + PERSISTENCE=memory ⇒ từ chối khởi động (exit ≠ 0), nêu đúng tên biến',
    async () => {
      const api = startApi(
        productionEnvVars({
          PORT: String(PORT_GUARD),
          DATABASE_URL: testDatabaseUrl(),
          APP_ENV: 'staging',
          PERSISTENCE: 'memory',
        }),
      );
      children.push(api.child);
      const code = await api.exited;
      expect(code).not.toBe(0);
      expect(api.output()).toContain('PERSISTENCE');
    },
    STARTUP_TIMEOUT_MS,
  );
});
