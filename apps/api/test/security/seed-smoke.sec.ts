import { spawn } from 'node:child_process';

import { beforeAll, describe, expect } from 'vitest';

import { API_DIR } from './harness/api-process';
import { loadHarnessConfig, postgresUrl } from './harness/config';
import type { RawResponse } from './harness/http-client';
import { secCase, useApi } from './harness/suite';

// SEED-SMOKE (TL 18/10 — lỗi #1 người dùng gặp: seed `TRUNCATE users CASCADE` xóa dòng `payroll_settings` do MIGRATION
// chèn ⇒ tạo bảng lương 500). Mọi cổng khác dựng DB bằng `migrate deploy` (+ bootstrap / API), KHÔNG đi qua seed ⇒ lớp
// lỗi "dữ liệu migration chèn bị seed làm mất" và "seed thiếu dữ liệu cho mốc mới" lọt qua. File này đi ĐÚNG đường của
// người dùng dev: migrate (harness) → `prisma/seed.ts` THẬT (cùng script `pnpm db:seed`) → `main.ts` THẬT → đăng nhập
// bằng tài khoản seed → gọi các luồng chính của từng vai; khẳng định không 5xx và đúng mã mong đợi.
// Thêm mốc mới ⇒ thêm luồng chính của mốc đó vào bảng ROUTES bên dưới.

const SEED_PASSWORD = 'Seed-smoke-2026-khong-dung-that';
const AREA = 'seed dev + app thật (TL 18/10)';

function runSeed(env: Record<string, string>): Promise<void> {
  // Seed thật xóa bằng TRUNCATE ⇒ chạy bằng vai migrator như dev (DATABASE_URL trong .env dev là chủ schema).
  const migratorUrl = postgresUrl(loadHarnessConfig(), 'migrator');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'prisma/seed.ts'], {
      cwd: API_DIR,
      env: {
        PATH: process.env.PATH ?? '',
        ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
        NODE_ENV: 'test',
        APP_ENV: 'test',
        DATABASE_URL: migratorUrl,
        SEED_PASSWORD,
        CORS_ORIGINS: env['CORS_ORIGINS'] ?? 'http://localhost:3001',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (c: Buffer) => (out += c.toString()));
    child.stderr.on('data', (c: Buffer) => (out += c.toString()));
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`prisma/seed.ts thoát ${String(code)}:\n${out.slice(-2000)}`)),
    );
  });
}

const api = useApi({}, undefined, { beforeStart: ({ env }) => runSeed(env) });

const PEOPLE = {
  olivia: 'olivia@example.test', // Admin
  pam: 'pam@example.test', // nhân viên + HR_MANAGE
  max: 'max@example.test', // nhân viên + PAYROLL_MANAGE
  mia: 'mia@example.test', // nhân viên
} as const;
type Who = keyof typeof PEOPLE;
const tokens = {} as Record<Who, string>;

async function call(who: Who, method: string, path: string, body?: unknown): Promise<RawResponse> {
  return api.request({
    method,
    path: `/api/v1${path}`,
    headers: {
      authorization: `Bearer ${tokens[who]}`,
      origin: api.webOrigin,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeAll(async () => {
  for (const who of Object.keys(PEOPLE) as Who[]) {
    const res = await api.request({
      method: 'POST',
      path: '/api/v1/auth/login',
      headers: { 'content-type': 'application/json', origin: api.webOrigin },
      body: JSON.stringify({ email: PEOPLE[who], password: SEED_PASSWORD }),
    });
    if (res.status !== 200)
      throw new Error(`đăng nhập seed ${who}: ${String(res.status)} ${res.text.slice(0, 200)}`);
    tokens[who] = (res.json as { data: { accessToken: string } }).data.accessToken;
  }
}, 60_000);

// Giờ VN thật (API không neo đồng hồ ở file này — seed dùng giờ thật).
const vnToday = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
const thisMonth = () => vnToday().slice(0, 7);
const prevMonth = () => {
  const [y, m] = thisMonth().split('-').map(Number) as [number, number];
  return m === 1 ? `${String(y - 1)}-12` : `${String(y)}-${String(m - 1).padStart(2, '0')}`;
};
const year = () => Number(vnToday().slice(0, 4));

/** [vai, method, path, mã chấp nhận]. Mỗi mốc thêm luồng chính của mình vào đây. */
const ROUTES: readonly (readonly [Who, string, () => string, readonly number[]])[] = [
  // chung (mọi vai đăng nhập)
  ...(['olivia', 'pam', 'max', 'mia'] as const).flatMap((w) => [
    [w, 'GET', () => '/auth/me', [200]] as const,
    [w, 'GET', () => '/company', [200]] as const,
    [w, 'GET', () => '/workspaces', [200]] as const,
    [w, 'GET', () => '/me/notifications?limit=20', [200]] as const,
    [w, 'GET', () => '/me/privacy', [200]] as const,
    [w, 'GET', () => '/chat/conversations', [200]] as const,
    [w, 'GET', () => '/chat/unread-count', [200]] as const,
  ]),
  // nhân viên (Mốc 3 / 3.5 / 5 / 4)
  ['mia', 'GET', () => '/attendance/me/today', [200]],
  ['mia', 'GET', () => `/attendance/me?month=${thisMonth()}`, [200]],
  ['mia', 'GET', () => `/leave/balances/me?year=${String(year())}`, [200]],
  ['mia', 'GET', () => '/leave/requests?mine=1', [200]],
  ['mia', 'GET', () => '/attendance/corrections?mine=1', [200]],
  ['mia', 'GET', () => '/hr/employee-profiles/me', [200]],
  ['mia', 'GET', () => '/payslips', [200]],
  // HR (Mốc 3.5 / 5)
  ['pam', 'GET', () => '/hr/employees', [200]],
  ['pam', 'GET', () => `/attendance?month=${thisMonth()}`, [200]],
  ['pam', 'GET', () => '/leave/requests', [200]],
  ['pam', 'GET', () => `/leave/balances?year=${String(year())}`, [200]],
  ['pam', 'GET', () => `/leave/policy?year=${String(year())}`, [200]],
  ['pam', 'GET', () => '/hr/employee-profiles/departments', [200]],
  ['pam', 'GET', () => '/attendance/corrections', [200]],
  // Kế toán (Mốc 4) — gồm TẠO NHÁP bảng lương kỳ đã kết thúc (lỗi #1: 500 vì mất payroll_settings)
  ['max', 'GET', () => '/payroll/settings', [200]],
  ['max', 'GET', () => '/payroll/salary-profiles', [200]],
  ['max', 'GET', () => '/payroll/runs', [200]],
  ['max', 'POST', () => `/payroll/runs/${prevMonth()}`, [200, 201]],
  ['max', 'GET', () => `/payroll/runs/${prevMonth()}`, [200]],
  // Admin (Mốc 3.5)
  ['olivia', 'GET', () => '/admin/access', [200]],
  ['olivia', 'GET', () => '/admin/workspaces', [200]],
  ['olivia', 'GET', () => '/hr/audit-logs', [200]],
];

describe('seed dev + app thật', () => {
  secCase(
    'SEED-SMOKE-01',
    'sau `prisma/seed.ts` trên DB đã migrate: mọi luồng chính của Admin / HR / Kế toán / nhân viên trả đúng mã, KHÔNG 5xx (gồm tạo nháp bảng lương kỳ trước — lỗi payroll_settings bị seed xóa)',
    AREA,
    async () => {
      const red: string[] = [];
      for (const [who, method, path, ok] of ROUTES) {
        const p = path();
        const res = await call(who, method, p, method === 'GET' ? undefined : {});
        if (!ok.includes(res.status))
          red.push(`${who} ${method} ${p} ⇒ ${String(res.status)} ${res.text.slice(0, 160)}`);
      }
      expect(red).toEqual([]);
    },
    120_000,
  );

  secCase(
    'SEED-SMOKE-02',
    'dữ liệu do migration chèn vẫn còn sau seed: payroll_settings đọc được qua API (mặc định 500 000); GET chính sách phép năm nay trả được (seed không tạo leave_policies ⇒ DEFAULT theo luật — không đòi dòng DB)',
    AREA,
    async () => {
      const s = await call('max', 'GET', '/payroll/settings');
      expect(s.status, s.text.slice(0, 200)).toBe(200);
      expect(
        (s.json as { data: { seniorityPerYear: number } }).data.seniorityPerYear,
      ).toBeGreaterThan(0);
      const p = await call('pam', 'GET', `/leave/policy?year=${String(year())}`);
      expect(p.status, p.text.slice(0, 200)).toBe(200);
      expect(['DEFAULT', 'INHERITED', 'SET']).toContain(
        (p.json as { data: { source: string } }).data.source,
      );
    },
  );
});
