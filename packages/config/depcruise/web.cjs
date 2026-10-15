// Luật layer Feature-Sliced Design của apps/web (frontend.md §2.3–2.4). Đường dẫn tương đối với apps/web.
// Chiều phụ thuộc: app/ (route Next) → src/app → views → widgets → features → entities → shared → contracts.

const SLICED = '(entities|features|widgets|views)';
const PUBLIC_API = `^src/${SLICED}/[^/]+/index\\.tsx?$`;

/** @type {import('dependency-cruiser').IForbiddenRuleType[]} */
const forbidden = [
  {
    name: 'fsd-no-upward-shared',
    severity: 'error',
    from: { path: '^src/shared/' },
    to: { path: '^src/(entities|features|widgets|views|app)/' },
  },
  {
    name: 'fsd-no-upward-entities',
    severity: 'error',
    from: { path: '^src/entities/' },
    to: { path: '^src/(features|widgets|views|app)/' },
  },
  {
    name: 'fsd-no-upward-features',
    severity: 'error',
    from: { path: '^src/features/' },
    to: { path: '^src/(widgets|views|app)/' },
  },
  {
    name: 'fsd-no-upward-widgets',
    severity: 'error',
    from: { path: '^src/widgets/' },
    to: { path: '^src/(views|app)/' },
  },
  {
    name: 'fsd-no-upward-views',
    severity: 'error',
    from: { path: '^src/views/' },
    to: { path: '^src/app/' },
  },
  {
    name: 'fsd-no-cross-slice',
    comment: 'Cùng layer, khác slice: cấm import nhau — ghép ở layer trên (frontend.md §2.3-2).',
    severity: 'error',
    from: { path: '^src/(features|widgets|views)/([^/]+)/' },
    to: { path: '^src/$1/(?!$2/)' },
  },
  {
    name: 'fsd-entities-cross-via-x',
    comment:
      'Entity B chỉ tham chiếu entity A qua entities/A/@x/B.ts — đúng file mang tên mình, ' +
      'kể cả index.ts của A cũng không (frontend.md §2.4).',
    severity: 'error',
    from: { path: '^src/entities/([^/]+)/' },
    to: { path: '^src/entities/[^/]+/', pathNot: '^src/entities/($1/|[^/]+/@x/$1\\.ts$)' },
  },
  {
    name: 'fsd-public-api-only',
    comment: 'Slice khác chỉ được import qua index.ts (frontend.md §2.3-3).',
    severity: 'error',
    from: { path: `^src/${SLICED}/([^/]+)/` },
    to: {
      path: `^src/${SLICED}/[^/]+/.+`,
      // Mẫu @x chỉ có thể khớp khi $1 = entities (layer khác không có đường dẫn src/<layer>/*/@x).
      pathNot: ['^src/$1/$2/', PUBLIC_API, '^src/$1/[^/]+/@x/$2\\.ts$'],
    },
  },
  {
    name: 'fsd-public-api-only-outside',
    comment: 'Như trên, cho file nằm ngoài các layer có slice (src/app, src/shared, app/).',
    severity: 'error',
    from: { pathNot: `^src/${SLICED}/` },
    to: { path: `^src/${SLICED}/[^/]+/.+`, pathNot: PUBLIC_API },
  },
  {
    name: 'route-files-thin',
    comment: 'File route Next chỉ render view — chỉ import src/views và src/app.',
    severity: 'error',
    from: { path: '^app/' },
    to: { path: '^src/(widgets|features|entities)/' },
  },
  {
    name: 'no-api-app',
    comment: 'Web không import code của apps/api (chỉ dùng @taskflow/contracts).',
    severity: 'error',
    from: { path: '^(app|src)/' },
    to: { path: '^(\\.\\./)+api/' },
  },
  {
    name: 'no-axios',
    comment: 'Không dùng axios (ADR-060).',
    severity: 'error',
    from: {},
    to: { path: '(^|/)axios(/|$)' },
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
  exclude: { path: '(^|/)(\\.next|dist|test/fixtures)/' },
  tsPreCompilationDeps: true,
  tsConfig: { fileName: 'tsconfig.json' },
  enhancedResolveOptions: {
    exportsFields: ['exports'],
    conditionNames: ['import', 'require', 'node', 'default', 'types'],
    extensions: ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json'],
  },
};

module.exports = { forbidden, options };
