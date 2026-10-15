// X5 (T-032, cross-read của F): cursor không ký ⇒ ai cũng tự tạo. `after` không phải uuid trước đây
// đi thẳng vào cột uuid ⇒ 500 + log error (mọi member, kể cả VIEWER, làm ngập alert được).
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { encodeCursor } from '../../src/core/http/cursor';
import { errorOf } from '../support/http';
import { createTestApp, type TestApp, type TestUser } from '../support/http-app';

let t: TestApp;
let alice: TestUser;
beforeEach(async () => {
  t = createTestApp();
  alice = await t.register('Alice');
});

const list = (path: string, cursor: string) =>
  request(t.app)
    .get(`/api/v1/workspaces/${alice.workspaceId}/${path}`)
    .query({ cursor })
    .set(alice.auth);

describe.each([
  ['members', 'members'],
  ['projects', 'projects'],
])('GET …/%s với cursor tự tạo', (path, kind) => {
  it.each(['x', "1' OR '1'='1", '00000000-0000-0000-0000-00000000000g'])(
    '`after` = %j ⇒ 400 invalid_cursor, không phải 500',
    async (after) => {
      const res = await list(path, encodeCursor(kind, { after }));
      expect(res.status).toBe(400);
      expect(errorOf(res).code).toBe('VALIDATION_ERROR');
    },
  );

  it('`after` là uuid hợp lệ nhưng không tồn tại ⇒ 200 (trang rỗng / từ đầu), không lỗi', async () => {
    const res = await list(path, encodeCursor(kind, { after: crypto.randomUUID() }));
    expect(res.status).toBe(200);
  });
});
