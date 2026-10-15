import { expect, it } from 'vitest';

import { GET } from './route';

it('healthz web: chỉ { status: "ok" }, không lộ gitSha, không cache', async () => {
  const response = GET();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: 'ok' });
  expect(response.headers.get('cache-control')).toBe('no-store');
});
