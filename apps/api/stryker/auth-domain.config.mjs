import { defineGroup } from './base.mjs';

export default defineGroup('auth-domain', {
  mutate: ['src/modules/auth/domain/**/*.ts'],
  tests: ['src/modules/auth'],
});
