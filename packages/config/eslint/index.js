// ESLint 10 flat config dùng chung (ADR-004, ADR-064, frontend.md §2.4).
// Luật kiến trúc ở đây là "máy ép": vi phạm = lint đỏ = không merge.
// Mỗi luật có fixture vi phạm trong packages/config/test/fixtures + test chứng minh lint bắt được.
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import nextPlugin from '@next/eslint-plugin-next';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import { maxUseState } from './rules/max-use-state.js';

const JS = '**/*.{js,mjs,cjs}';

const maxLines = (max) => ['error', { max, skipBlankLines: true, skipComments: true }];

/** Thư viện hạ tầng tầng domain không được biết tới (ADR-004, ADR-043). */
export const DOMAIN_FORBIDDEN_IMPORTS = [
  {
    group: ['@prisma/*', 'prisma', 'pg'],
    message: 'Domain không phụ thuộc ORM/DB (ADR-004).',
  },
  {
    group: ['**/generated/**'],
    message: 'Domain không import Prisma client sinh ra (ADR-004).',
  },
  { group: ['express', 'express/*'], message: 'Domain không phụ thuộc HTTP (ADR-004).' },
  {
    group: ['redis', '@redis/*', 'socket.io', 'socket.io/*', '@socket.io/*'],
    message: 'Domain không phụ thuộc Valkey/realtime (ADR-004).',
  },
  { group: ['zod', 'zod/*'], message: 'Validate ở biên (presentation/contracts), không ở domain.' },
  { group: ['jose', '@node-rs/*'], message: 'Crypto/JWT là hạ tầng — dùng port (ADR-004).' },
  {
    group: ['@taskflow/contracts', '@taskflow/contracts/*'],
    message: 'Domain không import contracts (ADR-043).',
  },
  { group: ['pino', 'pino-http'], message: 'Log qua port, không gọi pino trong domain.' },
];

const AXIOS = { name: 'axios', message: 'Dùng fetch wrapper `http` trong shared/api (ADR-060).' };
const SOCKET_IO_CLIENT = {
  group: ['socket.io-client', 'socket.io-client/*'],
  message: 'socket.io-client chỉ được import trong src/shared/socket (frontend.md §2.3-5).',
};
const DND_KIT = {
  group: ['@dnd-kit/*'],
  message:
    '@dnd-kit chỉ dùng trong widgets/kanban-board và features/task-move (frontend.md §2.3-5).',
};
const REACT_QUERY = {
  group: ['@tanstack/react-query', '@tanstack/react-query/*'],
  message: 'shared/ui là component "câm" — không gọi react-query (frontend.md §2.3-4).',
};
// Dùng regex vì pattern kiểu gitignore không "mở lại" được @x khi thư mục cha đã bị chặn.
const DEEP_SLICE_IMPORT = {
  regex: '^@/(?:(?:features|widgets|views)/[^/]+/.+|entities/[^/]+/(?!@x/[^/]+$).+)$',
  message: 'Chỉ import slice qua public API `@/<layer>/<slice>` (frontend.md §2.3-3).',
};

/** no-restricted-imports cho web: flat config KHÔNG gộp option của cùng một rule, nên mỗi vùng khai báo đủ bộ. */
const webImports = (...patterns) => [
  'error',
  { paths: [AXIOS], patterns: [DEEP_SLICE_IMPORT, ...patterns] },
];

const BROWSER_IO_GLOBALS = {
  fetch: {
    name: 'fetch',
    message: 'Gọi mạng chỉ qua `http` của src/shared/api (frontend.md §2.3-7).',
  },
  XMLHttpRequest: { name: 'XMLHttpRequest', message: 'Gọi mạng chỉ qua src/shared/api.' },
  localStorage: {
    name: 'localStorage',
    message: 'Không lưu dữ liệu trình duyệt tùy tiện (ADR-026) — dùng src/shared/lib/storage.ts.',
  },
  sessionStorage: { name: 'sessionStorage', message: 'Dùng src/shared/lib/storage.ts.' },
};
const restrictGlobals = (...names) => ['error', ...names.map((n) => BROWSER_IO_GLOBALS[n])];

/**
 * @param {object} opts
 * @param {string} [opts.rootDir] thư mục gốc cho typed linting (projectService). Bỏ trống = không typed lint.
 * @param {string} opts.api đường dẫn (tương đối từ cwd của ESLint) tới apps/api
 * @param {string} opts.web đường dẫn tới apps/web
 * @param {string[]} [opts.ignores]
 * @returns {import('eslint').Linter.Config[]}
 */
export function taskflow({ rootDir, api, web, ignores = [] }) {
  const typeChecked = Boolean(rootDir);
  const a = (glob) => `${api}/${glob}`;
  const w = (glob) => `${web}/${glob}`;

  return defineConfig(
    {
      name: 'taskflow/ignores',
      ignores: [
        '**/node_modules/**',
        '**/dist/**',
        '**/.next/**',
        '**/coverage/**',
        '**/generated/**',
        '**/next-env.d.ts',
        ...ignores,
      ],
    },
    { name: 'taskflow/linter-options', linterOptions: { reportUnusedDisableDirectives: 'error' } },

    // ---------- Nền chung ----------
    js.configs.recommended,
    ...(typeChecked
      ? [
          ...tseslint.configs.recommendedTypeChecked,
          {
            name: 'taskflow/type-info',
            languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: rootDir } },
          },
          { files: [JS], ...tseslint.configs.disableTypeChecked },
        ]
      : tseslint.configs.recommended),
    {
      name: 'taskflow/base',
      languageOptions: { globals: { ...globals.es2024 } },
      rules: {
        'no-restricted-imports': ['error', { paths: [AXIOS] }],
        '@typescript-eslint/consistent-type-imports': 'error',
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
        ],
      },
    },
    {
      name: 'taskflow/node-tooling',
      files: [JS, '*.ts', '**/*.config.ts'],
      languageOptions: { globals: globals.node },
    },
    {
      name: 'taskflow/commonjs',
      files: ['**/*.cjs'],
      languageOptions: { sourceType: 'commonjs' },
      rules: { '@typescript-eslint/no-require-imports': 'off' },
    },

    // ---------- apps/api ----------
    {
      name: 'taskflow/api',
      files: [a('**/*.ts')],
      languageOptions: { globals: globals.node },
      rules: {
        'max-lines': maxLines(200),
        'no-restricted-properties': [
          'error',
          {
            object: 'process',
            property: 'env',
            message:
              'Chỉ src/config đọc process.env; nơi khác nhận Env đã validate (devops.md §2.4).',
          },
        ],
      },
    },
    {
      name: 'taskflow/api-config-env',
      files: [a('src/config/**/*.ts'), a('*.config.ts'), a('test/**/*.ts'), a('**/*.test.ts')],
      rules: { 'no-restricted-properties': 'off' },
    },
    {
      name: 'taskflow/api-domain',
      files: [a('src/**/domain/**/*.ts')],
      rules: {
        'no-restricted-imports': ['error', { paths: [AXIOS], patterns: DOMAIN_FORBIDDEN_IMPORTS }],
      },
    },

    // ---------- apps/web ----------
    {
      name: 'taskflow/web',
      files: [w('**/*.{ts,tsx}')],
      plugins: {
        'react-hooks': reactHooks,
        '@next/next': nextPlugin,
        taskflow: { rules: { 'max-use-state': maxUseState } },
      },
      languageOptions: { globals: { ...globals.browser } },
      settings: { next: { rootDir: `${web}/` } },
      rules: {
        ...reactHooks.configs.flat.recommended.rules,
        'react-hooks/rules-of-hooks': 'error',
        'react-hooks/exhaustive-deps': 'error',
        ...nextPlugin.configs.recommended.rules,
        ...nextPlugin.configs['core-web-vitals'].rules,
        'max-lines': maxLines(200),
        'no-restricted-imports': webImports(SOCKET_IO_CLIENT, DND_KIT),
        'no-restricted-globals': restrictGlobals(
          'fetch',
          'XMLHttpRequest',
          'localStorage',
          'sessionStorage',
        ),
        'no-restricted-properties': [
          'error',
          ...['window', 'globalThis', 'self'].flatMap((object) => [
            { object, property: 'fetch', message: BROWSER_IO_GLOBALS.fetch.message },
            { object, property: 'localStorage', message: BROWSER_IO_GLOBALS.localStorage.message },
            {
              object,
              property: 'sessionStorage',
              message: BROWSER_IO_GLOBALS.sessionStorage.message,
            },
          ]),
        ],
      },
    },
    {
      name: 'taskflow/web-tsx',
      files: [w('**/*.tsx')],
      rules: {
        'max-lines': maxLines(150),
        'taskflow/max-use-state': ['error', { max: 3 }],
        'no-restricted-syntax': [
          'error',
          {
            selector: "CallExpression[callee.name='fetch']",
            message:
              'Cấm gọi fetch trong .tsx — dùng hook ở segment api/ của slice (frontend.md §2.3-7).',
          },
          {
            selector:
              "CallExpression[callee.type='MemberExpression'][callee.property.name='fetch']",
            message:
              'Cấm gọi fetch trong .tsx — dùng hook ở segment api/ của slice (frontend.md §2.3-7).',
          },
          {
            selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
            message: 'Cấm dangerouslySetInnerHTML — XSS = mất phiên (security.md §6.2).',
          },
        ],
      },
    },
    // Vùng ngoại lệ (đặt SAU cấu hình chung để ghi đè).
    {
      name: 'taskflow/web-shared-api',
      files: [w('src/shared/api/**/*.ts')],
      rules: {
        'no-restricted-globals': restrictGlobals(
          'XMLHttpRequest',
          'localStorage',
          'sessionStorage',
        ),
      },
    },
    {
      name: 'taskflow/web-shared-storage',
      files: [w('src/shared/lib/storage.ts')],
      rules: { 'no-restricted-globals': restrictGlobals('fetch', 'XMLHttpRequest') },
    },
    {
      name: 'taskflow/web-shared-socket',
      files: [w('src/shared/socket/**/*.{ts,tsx}')],
      rules: { 'no-restricted-imports': webImports(DND_KIT) },
    },
    {
      name: 'taskflow/web-dnd-zones',
      files: [
        w('src/widgets/kanban-board/**/*.{ts,tsx}'),
        w('src/features/task-move/**/*.{ts,tsx}'),
      ],
      rules: { 'no-restricted-imports': webImports(SOCKET_IO_CLIENT) },
    },
    {
      name: 'taskflow/web-shared-ui',
      files: [w('src/shared/ui/**/*.{ts,tsx}')],
      rules: { 'no-restricted-imports': webImports(SOCKET_IO_CLIENT, DND_KIT, REACT_QUERY) },
    },
    {
      name: 'taskflow/web-tests',
      files: [w('**/*.test.{ts,tsx}')],
      rules: { 'max-lines': 'off', 'taskflow/max-use-state': 'off' },
    },
    {
      name: 'taskflow/tests',
      files: ['**/*.test.{ts,tsx}', '**/test/**/*.ts'],
      rules: { 'max-lines': 'off' },
    },

    prettier,
  );
}
