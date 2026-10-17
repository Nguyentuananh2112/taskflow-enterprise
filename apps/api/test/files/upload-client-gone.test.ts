import * as fsp from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';

import express from 'express';
import { afterEach, beforeEach, expect, it } from 'vitest';

import { ServiceUnavailableError } from '../../src/core/errors';
import { LocalFileStore } from '../../src/core/files/infrastructure/local-file-store';
import { rawUpload, requireUpload } from '../../src/core/files/presentation/raw-upload';
import { UploadSlots } from '../../src/core/files/upload-slots';

// B (soát bước 3): client gửi đủ body rồi đi khi worker sharp còn chạy ⇒ response đóng ⇒ bản tạm bị bỏ ⇒
// commit phải là 503 có kiểm soát (không 500 trần), tmp không sót, lượt upload được nhả.
let root: string;
let server: http.Server;
beforeEach(async () => {
  root = await fsp.mkdtemp(path.join(os.tmpdir(), 'tf-gone-'));
});
afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await fsp.rm(root, { recursive: true, force: true });
});

it('client đi khi "worker" còn chạy ⇒ commit 503 ServiceUnavailableError, tmp sạch, lượt được nhả', async () => {
  const store = await LocalFileStore.create(root);
  const slots = new UploadSlots();
  let commitError: unknown;
  let readBytes = -1;
  let done!: () => void;
  const finished = new Promise<void>((r) => (done = r));

  const app = express();
  app.use((req, _res, next) => {
    req.user = { id: 'u', sid: 's' };
    next();
  });
  app.put(
    '/api/v1/me/avatar',
    rawUpload({ store, slots, maxBytes: 1 << 20, idleTimeoutMs: 5_000, totalTimeoutMs: 10_000 }),
    async (req, res) => {
      const { staged } = requireUpload(req);
      readBytes = (await staged.readAll()).length; // đọc TRƯỚC khi có thể bị discard (B)
      await new Promise((r) => setTimeout(r, 300)); // worker sharp đang chạy
      try {
        await staged.commit();
        res.json({ ok: true });
      } catch (err) {
        commitError = err;
        res.status(503).end();
      } finally {
        done();
      }
    },
  );
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const { port } = server.address() as AddressInfo;

  const body = Buffer.alloc(10_000, 1);
  const req = http.request({
    port,
    host: '127.0.0.1',
    method: 'PUT',
    path: '/api/v1/me/avatar',
    headers: {
      'content-type': 'application/octet-stream',
      'x-upload-name': 'a.png',
      'content-length': String(body.length),
    },
  });
  req.on('error', () => undefined);
  req.end(body, () => setTimeout(() => req.destroy(), 100)); // gửi đủ rồi đi giữa lúc xử lý

  await finished;
  expect(readBytes).toBe(body.length);
  expect(commitError).toBeInstanceOf(ServiceUnavailableError);
  expect(await fsp.readdir(path.join(root, 'tmp'))).toEqual([]);
  expect(slots.inFlight('u')).toBe(0);
});
