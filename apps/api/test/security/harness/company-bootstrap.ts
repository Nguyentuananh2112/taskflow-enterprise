import { spawn } from 'node:child_process';

import { API_DIR } from './api-process';

/**
 * Bootstrap Admin đầu tiên cho harness Mốc 3.5 (ADR-140, test-spec-company.md §1.1) — chạy CLI `admin:bootstrap`
 * thật, không chèn DB. Không import vitest ⇒ dùng được cả ở globalSetup E2E.
 */

export interface BootstrapResult {
  userId: string;
  email: string;
  link: string;
  token: string;
  /** Token Admin đầu tiên sống 24 giờ (design §4). */
  expiresAt: string;
}

/**
 * Entry CLI `admin:bootstrap` (B xác nhận; production `dist/cli/admin-bootstrap.js`). Đầu vào CHỈ qua env
 * `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_NAME` / `COMPANY_NAME` (`bootstrapEnv`); `SEC_BOOTSTRAP_ENTRY` để
 * trỏ worktree khác.
 */
export const BOOTSTRAP_ENTRY = process.env.SEC_BOOTSTRAP_ENTRY ?? 'src/cli/admin-bootstrap.ts';

/** Token nằm ở fragment `#t=` của link kích hoạt (không gửi lên server khi mở trang — design ADR-137). */
export function tokenOfLink(link: string): string {
  const token = new URLSearchParams(new URL(link).hash.slice(1)).get('t');
  if (!token) throw new Error(`Link kích hoạt không có fragment #t=…: ${link}`);
  return token;
}

/**
 * B (T-061, chốt theo design): `--json` in ĐÚNG MỘT dòng JSON ở stdout, là dòng cuối —
 * `{userId, activation: {token, link, expiresAt}}` (cùng dạng `HireEmployeeResponse.activation`); log đi stderr.
 * Kiểm chặt: dòng cuối phải là object đủ trường và `token` khớp fragment `#t=` của `link`.
 */
export function parseBootstrapOutput(stdout: string): Omit<BootstrapResult, 'email'> {
  const lines = stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const fail = (why: string) =>
    new Error(`admin:bootstrap --json: ${why}:\n${stdout.slice(0, 2000)}`);
  if (lines.filter((l) => l.startsWith('{')).length !== 1) {
    throw fail('stdout phải có đúng một dòng JSON');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(lines.at(-1) ?? '');
  } catch {
    throw fail('dòng cuối stdout không phải JSON');
  }
  const { userId, activation } = parsed as { userId?: unknown; activation?: unknown };
  const { link, token, expiresAt } = (activation ?? {}) as Record<string, unknown>;
  if (
    typeof userId !== 'string' ||
    typeof link !== 'string' ||
    typeof token !== 'string' ||
    typeof expiresAt !== 'string'
  ) {
    throw fail('thiếu {userId, activation: {token, link, expiresAt}}');
  }
  if (tokenOfLink(link) !== token) throw fail('token không khớp fragment #t= của link');
  return { userId, link, token, expiresAt };
}

/** Dời một mốc ISO (vd `TEST_CLOCK_ANCHOR` cho restart). */
export const shiftIso = (iso: string, ms: number): string =>
  new Date(Date.parse(iso) + ms).toISOString();

export const DAY_MS = 86_400_000;

/**
 * Chạy `admin:bootstrap --json` với env của suite (cùng `DATABASE_URL`, `APP_ENV=test`, `TEST_CLOCK_ANCHOR`).
 * Exit ≠ 0 hoặc không có `{link, userId}` ⇒ ném lỗi kèm output (cả file đỏ — §1.1). Trả cả exit code/output
 * cho SEC-HR-64 qua `runBootstrapRaw`.
 */
export function runBootstrapRaw(
  env: Record<string, string>,
  args: readonly string[] = ['--json'],
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', BOOTSTRAP_ENTRY, ...args], {
      cwd: API_DIR,
      env: {
        PATH: process.env.PATH ?? '',
        ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
        METRICS_PORT: '0',
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (c: Buffer) => (stdout += c.toString('utf8')));
    child.stderr?.on('data', (c: Buffer) => (stderr += c.toString('utf8')));
    child.once('error', reject);
    child.once('exit', (code) => resolve({ code, stdout, stderr }));
  });
}

export function bootstrapEnv(
  env: Record<string, string>,
  admin: { email: string; name?: string; company?: string },
): Record<string, string> {
  return {
    // B (fbbf71f): CLI gọi loadEnv đầy đủ như API + cần PERSISTENCE=prisma; Valkey phải sống.
    PERSISTENCE: 'prisma',
    ...env,
    BOOTSTRAP_ADMIN_EMAIL: admin.email,
    BOOTSTRAP_ADMIN_NAME: admin.name ?? 'Sec Ada',
    COMPANY_NAME: admin.company ?? 'Sec Company',
  };
}

export async function runBootstrap(
  env: Record<string, string>,
  admin: { email: string; name?: string; company?: string },
): Promise<BootstrapResult> {
  const { code, stdout, stderr } = await runBootstrapRaw(bootstrapEnv(env, admin));
  if (code !== 0) {
    throw new Error(`admin:bootstrap thoát ${code}:\n${stdout}\n${stderr}`.slice(0, 4000));
  }
  return { ...parseBootstrapOutput(stdout), email: admin.email };
}
