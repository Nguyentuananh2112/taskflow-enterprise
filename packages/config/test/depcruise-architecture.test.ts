// Chứng minh từng luật dependency-cruiser (ADR-004, ADR-093, frontend.md §2.4) bắt được vi phạm mẫu.
// Chạy đúng CLI `depcruise` như `pnpm lint` (cùng config, cùng cách resolve alias qua tsconfig).
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { beforeAll, describe, expect, it } from 'vitest';

const run = promisify(execFile);

const FIXTURES = path.join(import.meta.dirname, 'fixtures', 'depcruise');
const CONFIG_DIR = path.join(import.meta.dirname, '..', 'depcruise');
// Gói chỉ export "./src/main/index.mjs" → đi ngược lên thư mục gốc gói để lấy bin.
const DEPCRUISE_BIN = path.join(
  fileURLToPath(import.meta.resolve('dependency-cruiser')),
  '../../../bin/dependency-cruiser.mjs',
);

interface Violation {
  from: string;
  to: string;
  rule: { name: string };
}

async function cruise(app: 'api' | 'web', targets: string[]): Promise<Violation[]> {
  const args = [
    DEPCRUISE_BIN,
    ...targets,
    '--config',
    path.join(CONFIG_DIR, `${app}.cjs`),
    '--output-type',
    'json',
  ];
  const cwd = path.join(FIXTURES, app);
  // depcruise thoát mã ≠ 0 khi có vi phạm error — vẫn đọc stdout.
  const { stdout } = await run(process.execPath, args, { cwd, maxBuffer: 16 * 1024 * 1024 }).catch(
    (error: { stdout?: string }) => {
      if (!error.stdout) throw error;
      return { stdout: error.stdout };
    },
  );
  const result = JSON.parse(stdout) as { summary: { violations: Violation[] } };
  return result.summary.violations;
}

const hits = (violations: Violation[], rule: string) =>
  violations.filter((v) => v.rule.name === rule).map((v) => v.from);

describe('dependency-cruiser — apps/api', () => {
  let violations: Violation[];
  beforeAll(async () => {
    violations = await cruise('api', ['src']);
  });

  it.each([
    ['domain-is-pure', 'src/modules/task/domain/uses-application.ts'],
    ['application-no-infra', 'src/modules/task/application/uses-infrastructure.ts'],
    ['module-public-api-only', 'src/modules/workspace/application/uses-task-internal.ts'],
    ['core-no-modules', 'src/core/application/uses-module.ts'],
    ['no-axios', 'src/modules/task/infrastructure/uses-axios.ts'],
    ['no-web-from-api', 'src/core/infrastructure/uses-web.ts'],
    ['no-circular', 'src/core/domain/cycle-a.ts'],
  ])('%s bắt %s', (rule, from) => {
    expect(hits(violations, rule)).toContain(from);
  });

  it('import module khác qua index.ts là hợp lệ', () => {
    const from = 'src/modules/workspace/application/uses-task-public.ts';
    expect(violations.filter((v) => v.from === from)).toEqual([]);
  });

  it('không có vi phạm ngoài fixture đã khai báo', () => {
    const allowed = new Set([
      'src/modules/task/domain/uses-application.ts',
      'src/modules/task/application/uses-infrastructure.ts',
      'src/modules/workspace/application/uses-task-internal.ts',
      'src/core/application/uses-module.ts',
      'src/modules/task/infrastructure/uses-axios.ts',
      'src/core/infrastructure/uses-web.ts',
      'src/core/domain/cycle-a.ts',
      'src/core/domain/cycle-b.ts',
    ]);
    expect(violations.map((v) => v.from).filter((f) => !allowed.has(f))).toEqual([]);
  });
});

describe('dependency-cruiser — apps/web (FSD)', () => {
  let violations: Violation[];
  beforeAll(async () => {
    violations = await cruise('web', ['app', 'src']);
  });

  const EXPECTED: [string, string][] = [
    ['fsd-no-upward-shared', 'src/shared/lib/uses-entity.ts'],
    ['fsd-no-upward-entities', 'src/entities/task/model/uses-feature.ts'],
    ['fsd-no-upward-features', 'src/features/task-edit/model/uses-widget.ts'],
    ['fsd-no-upward-widgets', 'src/widgets/board/model/uses-view.ts'],
    ['fsd-no-upward-views', 'src/views/home/model/uses-app.ts'],
    ['fsd-no-cross-slice', 'src/features/task-edit/model/uses-other-feature.ts'],
    ['fsd-no-cross-slice', 'src/widgets/board/model/uses-other-widget.ts'],
    ['fsd-entities-cross-via-x', 'src/entities/task/model/uses-user-internal.ts'],
    ['fsd-entities-cross-via-x', 'src/entities/task/model/uses-other-x.ts'],
    ['fsd-entities-cross-via-x', 'src/entities/task/model/uses-user-index.ts'],
    ['fsd-public-api-only', 'src/widgets/board/model/deep-import.ts'],
    ['fsd-public-api-only', 'src/features/task-edit/model/uses-entity-x.ts'],
    ['fsd-public-api-only-outside', 'src/app/deep-import.ts'],
    ['route-files-thin', 'app/board/page.ts'],
    ['no-api-app', 'src/shared/lib/uses-api.ts'],
    ['no-axios', 'src/shared/api/uses-axios.ts'],
    ['no-circular', 'src/shared/lib/cycle-a.ts'],
  ];

  it.each(EXPECTED)('%s bắt %s', (rule, from) => {
    expect(hits(violations, rule)).toContain(from);
  });

  it.each([
    ['route chỉ import views', 'app/page.ts'],
    ['entity → entity khác qua @x', 'src/entities/task/model/uses-user-x.ts'],
    ['widget ghép 2 feature qua public API', 'src/widgets/board/model/composes-features.ts'],
    ['src/app import view qua public API', 'src/app/providers.ts'],
    ['import sâu trong cùng slice', 'src/features/task-edit/model/edit.ts'],
  ])('hợp lệ: %s', (_label, from) => {
    expect(violations.filter((v) => v.from === from)).toEqual([]);
  });

  it('không có vi phạm ngoài fixture đã khai báo', () => {
    const allowed = new Set([...EXPECTED.map(([, from]) => from), 'src/shared/lib/cycle-b.ts']);
    expect(violations.map((v) => v.from).filter((f) => !allowed.has(f))).toEqual([]);
  });
});
