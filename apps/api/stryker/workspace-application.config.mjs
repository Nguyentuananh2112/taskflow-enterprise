import { defineGroup } from './base.mjs';

export default defineGroup('workspace-application', {
  mutate: ['src/modules/workspace/application/**/*.ts'],
  tests: ['src/modules/workspace'],
});
