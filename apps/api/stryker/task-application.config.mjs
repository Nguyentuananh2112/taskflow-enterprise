import { defineGroup } from './base.mjs';

export default defineGroup('task-application', {
  mutate: ['src/modules/task/application/**/*.ts'],
  tests: ['src/modules/task'],
});
