import { defineGroup } from './base.mjs';

export default defineGroup('task-presentation', {
  mutate: ['src/modules/task/presentation/**/*.ts'],
  tests: ['src/modules/task', 'test/http'],
});
