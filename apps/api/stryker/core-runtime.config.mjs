import { defineGroup } from './base.mjs';

export default defineGroup('core-runtime', {
  mutate: ['src/core/{context,domain,events,infrastructure,lifecycle,logging,persistence}/**/*.ts'],
  tests: ['src/core', 'src/app.test.ts'],
});
