import { defineGroup } from './base.mjs';

export default defineGroup('auth-application', {
  mutate: ['src/modules/auth/application/**/*.ts'],
  tests: ['src/modules/auth'],
});
