import * as z from 'zod';
import { expect, it } from 'vitest';

// SEC-48: entry client bật `jitless` để Zod không dò `new Function` (vi phạm CSP script-src eval).
it('instrumentation-client bật z.config({ jitless: true })', async () => {
  await import('../instrumentation-client');
  expect(z.config().jitless).toBe(true);
});
