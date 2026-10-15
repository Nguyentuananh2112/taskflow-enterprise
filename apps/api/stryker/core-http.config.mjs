import { defineGroup } from './base.mjs';

export default defineGroup('core-http', {
  mutate: ['src/core/http/**/*.ts'],
  tests: ['src/core', 'src/app.test.ts'],
});
