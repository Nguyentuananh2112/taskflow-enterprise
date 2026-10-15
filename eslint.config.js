import { taskflow } from '@taskflow/config/eslint';

export default taskflow({
  rootDir: import.meta.dirname,
  api: 'apps/api',
  web: 'apps/web',
  // Fixture vi phạm cố ý — chỉ được lint bởi test của packages/config.
  ignores: ['**/test/fixtures/**'],
});
