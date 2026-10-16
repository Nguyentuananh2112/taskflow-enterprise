import { defineGroup } from './base.mjs';

export default defineGroup('auth-presentation', {
  mutate: ['src/modules/auth/presentation/**/*.ts'],
  tests: ['src/modules/auth', 'test/http'],
});
