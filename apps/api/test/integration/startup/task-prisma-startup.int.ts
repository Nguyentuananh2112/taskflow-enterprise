// T-023: sau khi module Task có repository Prisma, `main.ts` THẬT ở staging với cấu hình mặc định
// (PERSISTENCE = prisma) phải khởi động được — guard "không module bộ nhớ ở
// staging/production" (T-020) không còn chặn vì `modules.task = prisma`.
import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { productionEnvVars } from '../../support';
import { testDatabaseUrl } from '../db';
import { stopChildren } from '../support/child-process';

const API_DIR = resolve(import.meta.dirname, '../../..');
const PORT = 4900 + Math.floor(Math.random() * 90);
const STARTUP_TIMEOUT_MS = 120_000;
const children: ChildProcess[] = [];
afterAll(() => stopChildren(children));

describe('khởi động main.ts với Prisma đầy đủ (T-023)', () => {
  it(
    'APP_ENV=staging, mặc định prisma cho mọi module ⇒ /readyz xanh, không cảnh báo module bộ nhớ',
    async () => {
      // T-031 (L1): staging bắt buộc cấu hình production đầy đủ (NODE_ENV=production, secret thật,
      // rediss://…). Valkey `rediss://valkey.internal` không tới được ⇒ chỉ `degraded` (ADR-074),
      // /readyz vẫn 200 — điều cần chứng minh là module Task chạy Prisma, không bị guard chặn.
      const env = productionEnvVars({
        PORT: String(PORT),
        APP_ENV: 'staging',
        DATABASE_URL: testDatabaseUrl(),
      });
      // Không đặt PERSISTENCE: khẳng định giá trị MẶC ĐỊNH là prisma.
      delete env.PERSISTENCE;
      let output = '';
      const child = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
        cwd: API_DIR,
        env: { ...process.env, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      children.push(child);
      child.stdout.on('data', (b: Buffer) => (output += b.toString()));
      child.stderr.on('data', (b: Buffer) => (output += b.toString()));
      let exitCode: number | null | undefined;
      child.once('exit', (code) => (exitCode = code));

      const deadline = Date.now() + STARTUP_TIMEOUT_MS;
      let ready = false;
      while (!ready && exitCode === undefined && Date.now() < deadline) {
        ready = await fetch(`http://127.0.0.1:${PORT}/readyz`).then(
          (r) => r.status === 200,
          () => false,
        );
        if (!ready) await new Promise((r) => setTimeout(r, 500));
      }
      expect(ready, `API không sẵn sàng (exit=${String(exitCode)}):\n${output}`).toBe(true);
      expect(output).not.toContain('persistence.in_memory_data_lost_on_restart');
      expect(output).not.toContain('Lưu trữ bộ nhớ không được dùng');
    },
    STARTUP_TIMEOUT_MS + 30_000,
  );
});
