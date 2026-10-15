// Chứng minh từng luật kiến trúc ESLint (ADR-004, frontend.md §2.4) bắt được vi phạm mẫu,
// và không báo nhầm ở các trường hợp hợp lệ. Fixture: test/fixtures/eslint/{api,web}.
import path from 'node:path';

import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

import { taskflow } from '../eslint/index.js';

const FIXTURES = path.join(import.meta.dirname, 'fixtures', 'eslint');

/** Rule kiến trúc — fixture hợp lệ không được dính rule nào trong số này. */
const ARCH_RULES = [
  'max-lines',
  'no-restricted-imports',
  'no-restricted-globals',
  'no-restricted-properties',
  'no-restricted-syntax',
  'taskflow/max-use-state',
];

let results: Map<string, ESLint.LintResult>;

beforeAll(async () => {
  const eslint = new ESLint({
    cwd: FIXTURES,
    overrideConfigFile: true,
    // Không typed-lint ở fixture: các luật kiến trúc không cần thông tin kiểu.
    overrideConfig: taskflow({ api: 'api', web: 'web' }),
  });
  const lintResults = await eslint.lintFiles(['api/**/*.ts', 'web/**/*.{ts,tsx}']);
  results = new Map(
    lintResults.map((r) => [path.relative(FIXTURES, r.filePath).split(path.sep).join('/'), r]),
  );
});

function errorsOf(file: string) {
  const result = results.get(file);
  if (!result) throw new Error(`Fixture không được lint: ${file}`);
  const fatal = result.messages.filter((m) => m.fatal);
  expect(fatal, `lỗi parse ở ${file}`).toEqual([]);
  return result.messages.filter((m) => m.severity === 2);
}

const ruleIdsOf = (file: string) => errorsOf(file).map((m) => m.ruleId);

describe('API — domain không import hạ tầng (no-restricted-imports)', () => {
  it.each([
    'imports-prisma',
    'imports-generated',
    'imports-express',
    'imports-valkey',
    'imports-socket-io',
    'imports-zod',
    'imports-jose',
    'imports-argon2',
    'imports-contracts',
    'imports-pino',
  ])('%s bị chặn', (name) => {
    expect(ruleIdsOf(`api/src/modules/task/domain/${name}.ts`)).toContain('no-restricted-imports');
  });

  it('domain import domain cùng module là hợp lệ', () => {
    expect(ruleIdsOf('api/src/modules/task/domain/task.entity.ts')).toEqual([]);
  });
});

describe('API — luật khác', () => {
  it('max-lines 200 cho file backend', () => {
    expect(ruleIdsOf('api/src/modules/task/application/too-long.ts')).toContain('max-lines');
  });

  it('max-lines bỏ qua dòng trống và comment', () => {
    expect(ruleIdsOf('api/src/modules/task/application/long-but-comments.ts')).not.toContain(
      'max-lines',
    );
  });

  it('chỉ src/config được đọc process.env', () => {
    expect(ruleIdsOf('api/src/modules/task/application/reads-env.ts')).toContain(
      'no-restricted-properties',
    );
    expect(ruleIdsOf('api/src/config/env.ts')).not.toContain('no-restricted-properties');
  });

  it('cấm axios', () => {
    expect(ruleIdsOf('api/src/modules/task/infrastructure/uses-axios.ts')).toContain(
      'no-restricted-imports',
    );
  });
});

describe('Web — vi phạm bị bắt', () => {
  it.each([
    ['web/src/widgets/board/ui/too-long.tsx', 'max-lines', '.tsx > 150 dòng'],
    ['web/src/shared/lib/too-long.ts', 'max-lines', '.ts > 200 dòng'],
    ['web/src/features/task-edit/ui/calls-fetch.tsx', 'no-restricted-syntax', 'fetch( trong .tsx'],
    [
      'web/src/features/task-edit/ui/calls-window-fetch.tsx',
      'no-restricted-syntax',
      'window.fetch( trong .tsx',
    ],
    [
      'web/src/entities/task/model/fetch-global.ts',
      'no-restricted-globals',
      'fetch ngoài shared/api',
    ],
    [
      'web/src/entities/task/model/local-storage.ts',
      'no-restricted-globals',
      'localStorage ngoài storage.ts',
    ],
    [
      'web/src/features/task-edit/ui/dangerous-html.tsx',
      'no-restricted-syntax',
      'dangerouslySetInnerHTML',
    ],
    ['web/src/features/task-edit/ui/many-state.tsx', 'taskflow/max-use-state', '4 × useState'],
    ['web/src/features/task-edit/api/uses-axios.ts', 'no-restricted-imports', 'axios'],
    [
      'web/src/features/task-edit/model/uses-socket.ts',
      'no-restricted-imports',
      'socket.io-client ngoài shared/socket',
    ],
    [
      'web/src/features/task-edit/ui/uses-dnd.tsx',
      'no-restricted-imports',
      '@dnd-kit ngoài vùng cho phép',
    ],
    [
      'web/src/shared/ui/button/uses-react-query.ts',
      'no-restricted-imports',
      'react-query trong shared/ui',
    ],
    ['web/src/widgets/board/model/deep-import.ts', 'no-restricted-imports', 'import sâu vào slice'],
  ])('%s → %s (%s)', (file, ruleId) => {
    expect(ruleIdsOf(file)).toContain(ruleId);
  });
});

describe('Web — trường hợp hợp lệ không bị báo nhầm', () => {
  it.each([
    'web/src/features/task-edit/ui/three-state.tsx',
    'web/src/shared/socket/client.ts',
    'web/src/widgets/kanban-board/ui/board.tsx',
    'web/src/features/task-move/model/use-move.ts',
    'web/src/shared/api/http.ts',
    'web/src/shared/lib/storage.ts',
    'web/src/widgets/board/model/public-import.ts',
  ])('%s', (file) => {
    const archErrors = errorsOf(file).filter((m) => ARCH_RULES.includes(m.ruleId ?? ''));
    expect(archErrors).toEqual([]);
  });
});
