import { defineGroup } from './base.mjs';

export default defineGroup('workspace-infrastructure', {
  mutate: ['src/modules/workspace/infrastructure/jobs/**/*.ts'],
  tests: ['src/modules/workspace', 'src/composition/maintenance-jobs.test.ts'],
});
