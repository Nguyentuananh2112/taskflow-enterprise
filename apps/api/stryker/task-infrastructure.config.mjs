import { defineGroup } from './base.mjs';

export default defineGroup('task-infrastructure', {
  mutate: ['src/modules/task/infrastructure/rank/**/*.ts'],
  tests: ['src/modules/task'],
});
