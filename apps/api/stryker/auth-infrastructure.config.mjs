import { defineGroup } from './base.mjs';

export default defineGroup('auth-infrastructure', {
  mutate: ['src/modules/auth/infrastructure/**/*.ts'],
  tests: ['src/modules/auth'],
});
