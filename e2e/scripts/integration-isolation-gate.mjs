// Cổng hộp đen F2 (flake integration ~186/364): chạy `test:integration` thật, xét EXIT CODE + log.
// (a) VITEST_MAX_WORKERS=2, 1 lượt ⇒ phải xanh và không có lỗi do 2 file chạy song song.
// (b) 2 lượt song song cùng DB ⇒ lượt sau phải CHỜ hoặc TỪ CHỐI rõ ràng (không chạy test nào),
//     không deadlock / dữ liệu bẩn.
// Dùng DB riêng `taskflow_f2gate` (ADR-106) + Valkey db 9 riêng. Đỏ trên main 06ed261 (trước fix của D).
//
//   node e2e/scripts/integration-isolation-gate.mjs a|b|ab   (chạy từ gốc repo; cần pnpm trên PATH)
//   Env: F2_GATE_PG (gốc kết nối migrator, không tên DB), F2_GATE_DB, F2_GATE_VALKEY, F2_GATE_OUT.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MODE = process.argv[2] ?? 'ab';
const DB = process.env.F2_GATE_DB ?? 'taskflow_f2gate';
// Gốc kết nối (không kèm tên DB, role có CREATEDB). Mặc định = postgres-test local (runbook local-dev §5);
// CI đặt F2_GATE_PG trỏ service container. Bỏ `/` cuối để ghép `${PG}/${DB}`.
const PG = (
  process.env.F2_GATE_PG ?? 'postgresql://taskflow_migrator:migrator_local_only@127.0.0.1:5434'
).replace(/\/+$/, '');
const OUT = process.env.F2_GATE_OUT ?? join(process.cwd(), 'e2e', 'test-results', 'f2-gate');
mkdirSync(OUT, { recursive: true });

// Lỗi đặc trưng của 2 tiến trình cùng ghi một DB (log Postgres + Prisma lượt đỏ của TL).
const CONTENTION =
  /40P01|deadlock detected|P2002|P2003|Unique constraint failed|Foreign key constraint/;

function run(label, extraEnv) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn('pnpm', ['--filter', '@taskflow/api', 'test:integration'], {
      shell: true,
      env: {
        ...process.env,
        DATABASE_URL_TEST: `${PG}/${DB}`,
        VALKEY_URL_TEST: process.env.F2_GATE_VALKEY ?? 'redis://127.0.0.1:6380/9', // db riêng (E2E dùng 12/14)
        REQUIRE_INTEGRATION: '1',
        ...extraEnv,
      },
    });
    let log = '';
    child.stdout.on('data', (b) => (log += b.toString()));
    child.stderr.on('data', (b) => (log += b.toString()));
    child.on('exit', (code) => {
      writeFileSync(join(OUT, `${label}.log`), log);
      const summary =
        log.match(/Tests\s+[^\n]*\(\d+\)/g)?.at(-1) ??
        '(không có dòng Tests — không chạy test nào)';
      resolve({
        label,
        code,
        secs: Math.round((Date.now() - started) / 1000),
        summary,
        ranTests: /Tests\s+[^\n]*\(\d+\)/.test(log),
        contention: (log.match(CONTENTION) ?? [])[0] ?? null,
        // Hạ tầng hỏng (vd ERR_PNPM_VERIFY_DEPS_BEFORE_RUN) KHÔNG được tính là "từ chối rõ ràng".
        infraError: (log.match(/ERR_PNPM_[A-Z_]+/) ?? [])[0] ?? null,
        // Từ chối hợp lệ phải nói rõ là do khóa / lượt khác đang chạy.
        lockRefusal: /advisory|lock|khóa|đang (được )?(dùng|chạy)/i.test(log),
      });
    });
  });
}

async function ensureDb() {
  const { createRequire } = await import('node:module');
  const req = createRequire(join(process.cwd(), 'apps', 'api', 'package.json'));
  const pg = req('pg');
  const c = new pg.Client({ connectionString: `${PG}/postgres` });
  await c.connect();
  try {
    const r = await c.query('SELECT 1 FROM pg_database WHERE datname = $1', [DB]);
    if (r.rowCount === 0) await c.query(`CREATE DATABASE "${DB}"`);
  } finally {
    await c.end();
  }
}

const verdicts = [];
await ensureDb();

if (MODE.includes('a')) {
  const r = await run('a-workers2', { VITEST_MAX_WORKERS: '2' });
  const ok = r.code === 0 && r.ranTests && !r.contention && !r.infraError;
  verdicts.push({ gate: 'a: VITEST_MAX_WORKERS=2, 1 lượt', ok, ...r });
}

if (MODE.includes('b')) {
  const first = run('b-run1', {});
  await new Promise((r) => setTimeout(r, 20_000)); // lượt 1 đã qua globalSetup, đang chạy test
  const second = run('b-run2', {});
  const [r1, r2] = await Promise.all([first, second]);
  // Lượt 2 hợp lệ nếu: chờ xong rồi xanh, HOẶC từ chối rõ ràng mà không chạy test nào (exit ≠ 0).
  const r2ok =
    !r2.infraError &&
    ((r2.code === 0 && r2.ranTests && !r2.contention) ||
      (r2.code !== 0 && !r2.ranTests && r2.lockRefusal));
  const ok = r1.code === 0 && r1.ranTests && !r1.contention && !r1.infraError && r2ok;
  verdicts.push({ gate: 'b: 2 lượt song song cùng DB', ok, run1: r1, run2: r2 });
}

console.log(JSON.stringify(verdicts, null, 2));
console.log(verdicts.every((v) => v.ok) ? 'F2 GATE: XANH' : 'F2 GATE: ĐỎ');
process.exit(verdicts.every((v) => v.ok) ? 0 : 1);
