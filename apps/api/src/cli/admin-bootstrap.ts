// `admin:bootstrap` — Admin đầu tiên của công ty (ADR-137, SEC-HR-64). Chạy: `pnpm --filter @taskflow/api
// admin:bootstrap` (production `node dist/cli/admin-bootstrap.js`), cùng env với API.
//
// - Đọc BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_NAME, COMPANY_NAME; thiếu ⇒ thoát lỗi, KHÔNG có admin mặc định.
// - Chỉ chạy TƯƠNG TÁC (TTY + gõ xác nhận — B MEDIUM-2). `--json` (không hỏi, một dòng JSON cuối stdout) CHỈ khi
//   APP_ENV=test — harness security / E2E. Log luôn ra stderr.
// - `--reissue-link`: cấp lại link 24 giờ khi mọi Admin còn chờ kích hoạt.
// Exit: 0 = đã tạo / nâng / cấp lại; 1 = từ chối (đã có Admin, email không dùng được…); 2 = sai cấu hình.
import { createInterface } from 'node:readline/promises';

import { Email, FullName, applyVietnameseZodLocale } from '@taskflow/contracts';
import pino from 'pino';

import { appConfigFromEnv } from '../app';
import { createContainer } from '../composition/container';
import { createPrismaPersistence } from '../composition/prisma-persistence';
import { EnvValidationError, loadEnv, type Env } from '../config/env';
import { CryptoRandom, UuidV7Generator, clocksForEnv } from '../core/infrastructure/system';
import { createValkeyClient } from '../core/infrastructure/valkey';
import { createLogger } from '../core/logging/pino-logger';
import { createPgPool, createPrismaClient } from '../core/persistence/database';
import { PrismaClient } from '../generated/prisma/client';
import { PasswordPolicy } from '../modules/auth/domain/password-policy';
import { Argon2idPasswordHasher } from '../modules/auth/infrastructure/security/argon2id-password-hasher';
import { MemoryStore } from 'express-rate-limit';

const EXIT_REFUSED = 1;
const EXIT_CONFIG = 2;

const REFUSALS: Record<string, string> = {
  admin_exists: 'Đã có Admin — không làm gì.',
  email_unavailable: 'Email thuộc tài khoản đã xóa — không dùng được.',
  nothing_to_reissue: 'Chưa có Admin nào — chạy không kèm --reissue-link.',
  admin_activated: 'Đã có Admin kích hoạt — Admin đó tự quản trị, CLI không cấp lại link.',
};

function fail(code: number, message: string): never {
  process.stderr.write(`[admin:bootstrap] ${message}\n`);
  process.exit(code);
}

function readEnv(): Env {
  try {
    return loadEnv();
  } catch (err) {
    if (err instanceof EnvValidationError) fail(EXIT_CONFIG, err.message); // chỉ tên biến, không giá trị
    throw err;
  }
}

function readInput(): { email: string; fullName: string; companyName: string } {
  // eslint-disable-next-line no-restricted-properties -- biến riêng của CLI, không thuộc env của server
  const { BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_NAME, COMPANY_NAME } = process.env;
  const email = Email.safeParse(BOOTSTRAP_ADMIN_EMAIL ?? '');
  const fullName = FullName.safeParse(BOOTSTRAP_ADMIN_NAME ?? '');
  const companyName = (COMPANY_NAME ?? '').trim();
  if (!email.success) fail(EXIT_CONFIG, 'BOOTSTRAP_ADMIN_EMAIL thiếu hoặc không hợp lệ.');
  if (!fullName.success) fail(EXIT_CONFIG, 'BOOTSTRAP_ADMIN_NAME thiếu hoặc không hợp lệ.');
  if (companyName.length === 0 || companyName.length > 100) {
    fail(EXIT_CONFIG, 'COMPANY_NAME thiếu hoặc dài quá 100 ký tự.');
  }
  return { email: email.data, fullName: fullName.data, companyName };
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return (await rl.question(`${question} Gõ "yes" để tiếp tục: `)).trim() === 'yes';
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const json = args.has('--json');
  const reissueLink = args.has('--reissue-link');
  const env = readEnv();
  if (json && env.APP_ENV !== 'test') fail(EXIT_CONFIG, '--json chỉ dùng được khi APP_ENV=test.');
  if (!json && !(process.stdin.isTTY && process.stderr.isTTY)) {
    fail(EXIT_CONFIG, 'Chỉ chạy tương tác (TTY) — không chạy trong script/pipeline.');
  }
  if (env.PERSISTENCE !== 'prisma') fail(EXIT_CONFIG, 'admin:bootstrap cần PERSISTENCE=prisma.');
  const input = readInput();
  applyVietnameseZodLocale();

  const logger = createLogger(
    { level: env.LOG_LEVEL, gitSha: env.GIT_SHA, appEnv: env.APP_ENV },
    pino.destination(2), // stdout dành cho kết quả (--json)
  );
  if (!json) {
    const action = reissueLink ? 'Cấp lại link kích hoạt Admin' : `Tạo Admin ${input.email}`;
    if (!(await confirm(`${action} cho công ty "${input.companyName}"?`))) {
      fail(EXIT_REFUSED, 'Đã hủy.');
    }
  }

  const pool = createPgPool({ connectionString: env.DATABASE_URL, max: 2 }, logger);
  const valkey = createValkeyClient(env.REDIS_URL, logger, env.VALKEY_SOCKET_TIMEOUT_MS);
  try {
    // Nâng nhân viên lên Admin thu hồi phiên (ADR-105: Valkey TRƯỚC commit) ⇒ cần Valkey sống từ đầu.
    await valkey.connect();
    const prisma = createPrismaClient(PrismaClient, pool);
    const { clock, businessClock } = clocksForEnv(env.TEST_CLOCK_ANCHOR, logger);
    const container = createContainer({
      config: {
        ...appConfigFromEnv(env),
        cookieSecure: env.COOKIE_SECURE,
        jwtSecret: env.JWT_ACCESS_SECRET,
        jwtPreviousSecret: env.JWT_ACCESS_SECRET_PREVIOUS,
        jwtAccessTtlSeconds: env.JWT_ACCESS_TTL_SECONDS,
      },
      logger,
      clock,
      businessClock,
      ids: new UuidV7Generator(),
      random: new CryptoRandom(),
      hasher: await Argon2idPasswordHasher.forEnv(env.APP_ENV, logger),
      policy: new PasswordPolicy(new Set()),
      persistence: createPrismaPersistence({ prisma, valkey, logger }),
      rateLimitStore: () => new MemoryStore(),
      probes: [],
      isShuttingDown: () => false,
    });
    const result = await container.company.bootstrapAdmin({ ...input, reissueLink });
    if (!('userId' in result)) fail(EXIT_REFUSED, REFUSALS[result.outcome] ?? result.outcome);

    const activation = result.activation
      ? { ...result.activation, expiresAt: result.activation.expiresAt.toISOString() }
      : null;
    if (json) {
      // Đúng MỘT dòng JSON, là dòng cuối stdout (harness F đọc dòng này).
      process.stdout.write(`${JSON.stringify({ userId: result.userId, activation })}\n`);
    } else if (activation) {
      process.stderr.write(
        `Admin chờ kích hoạt. Gửi link này cho ĐÚNG người đó (hết hạn ${activation.expiresAt}):\n${activation.link}\n`,
      );
    } else {
      process.stderr.write('Đã nâng nhân viên lên Admin — đăng nhập bằng mật khẩu hiện có.\n');
    }
  } finally {
    if (valkey.isOpen) await valkey.close();
    await pool.end();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(
    `[admin:bootstrap] thất bại: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
