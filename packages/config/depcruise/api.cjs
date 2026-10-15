// Ranh giới tầng & module của apps/api (ADR-004, ADR-093). Đường dẫn tương đối với apps/api.
// Cấu trúc: src/core/<layer>/…, src/modules/<module>/<layer>/…, layer ∈ domain|application|infrastructure|presentation.

/** @type {import('dependency-cruiser').IForbiddenRuleType[]} */
const forbidden = [
  {
    name: 'domain-is-pure',
    comment: 'domain không phụ thuộc application/infrastructure/presentation (ADR-004).',
    severity: 'error',
    from: { path: '(^|/)domain/' },
    to: { path: '(^|/)(application|infrastructure|presentation)/' },
  },
  {
    name: 'application-no-infra',
    comment:
      'application chỉ biết domain + port của nó; adapter wire ở composition root (ADR-016).',
    severity: 'error',
    from: { path: '(^|/)application/' },
    to: { path: '(^|/)(infrastructure|presentation)/' },
  },
  {
    name: 'module-public-api-only',
    comment:
      'Module A không import nội bộ module B — chỉ qua src/modules/<b>/index.ts (ADR-093). ' +
      'Giao tiếp nghiệp vụ dùng port DIP, wire ở composition root.',
    severity: 'error',
    from: { path: '^src/modules/([^/]+)/' },
    to: { path: '^src/modules/(?!$1/)[^/]+/', pathNot: '^src/modules/[^/]+/index\\.ts$' },
  },
  {
    name: 'core-no-modules',
    comment: 'src/core là kernel dùng chung — không biết tới module nghiệp vụ nào.',
    severity: 'error',
    from: { path: '^src/core/' },
    to: { path: '^src/modules/' },
  },
  {
    name: 'no-axios',
    comment: 'Không dùng axios (ADR-060).',
    severity: 'error',
    from: {},
    to: { path: '(^|/)axios(/|$)' },
  },
  {
    name: 'no-web-from-api',
    comment: 'API không import code của apps/web.',
    severity: 'error',
    from: { path: '^src/' },
    to: { path: '^(\\.\\./)+web/' },
  },
  {
    name: 'no-circular',
    severity: 'error',
    from: {},
    to: { circular: true },
  },
];

/** @type {import('dependency-cruiser').ICruiseOptions} */
const options = {
  doNotFollow: { path: 'node_modules' },
  exclude: { path: '(^|/)(dist|generated|test/fixtures)/' },
  tsPreCompilationDeps: true,
  tsConfig: { fileName: 'tsconfig.json' },
  enhancedResolveOptions: {
    exportsFields: ['exports'],
    conditionNames: ['import', 'require', 'node', 'default', 'types'],
    extensions: ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json'],
  },
};

module.exports = { forbidden, options };
