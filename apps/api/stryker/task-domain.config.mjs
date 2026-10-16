import { defineGroup } from './base.mjs';

export default defineGroup('task-domain', {
  mutate: ['src/modules/task/domain/**/*.ts'],
  tests: ['src/modules/task'],
});
