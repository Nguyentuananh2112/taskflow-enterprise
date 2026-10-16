import { defineGroup } from './base.mjs';

export default defineGroup('workspace-presentation', {
  mutate: ['src/modules/workspace/presentation/**/*.ts'],
  tests: ['src/modules/workspace', 'test/http'],
});
