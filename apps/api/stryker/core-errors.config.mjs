import { defineGroup } from './base.mjs';

export default defineGroup('core-errors', {
  mutate: ['src/core/errors/**/*.ts'],
  tests: ['src/core', 'src/app.test.ts'],
});
