import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { HealthzResponse } from '@taskflow/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createServer } from '../src/server';

describe('GET /healthz', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = createServer({ GIT_SHA: 'test-sha' }).listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  it('trả 200 và body đúng contract', async () => {
    const res = await fetch(`${baseUrl}/healthz`);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-powered-by')).toBeNull();
    expect(HealthzResponse.parse(await res.json())).toEqual({ status: 'ok', gitSha: 'test-sha' });
  });
});
