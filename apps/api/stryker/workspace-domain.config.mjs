import { defineGroup } from './base.mjs';

export default defineGroup('workspace-domain', {
  mutate: ['src/modules/workspace/domain/**/*.ts'],
  tests: ['src/modules/workspace'],
});
