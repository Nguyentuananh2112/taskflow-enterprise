import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { APIRequestContext } from '@playwright/test';

import {
  apiCreateTask,
  apiGetTask,
  apiLogin,
  apiRegister,
  type Seeded,
  type TaskFull,
} from '../support/api';
import { API_DIR, API_URL, WEB_ORIGIN } from '../support/env';
import { expect, flushValkey, newUser, test } from '../support/fixtures';

// Cổng HIGH T-033 (B tìm, A sửa): rebalance cùng cột gán cho thẻ ĐANG DI CHUYỂN đúng key cũ của nó ⇒
// không lưu ⇒ kẹt rank tạm `~<id>` ⇒ tạo task / move cuối cột ⇒ 500. Chuỗi thao tác chính xác của B.
// Tính N bằng CHÍNH thư viện server dùng (apps/api: fractional-indexing 4.0.0, ESM) — không thêm dependency.
const THRESHOLD = 64;

async function loadGenerateKeyBetween(): Promise<(a: string | null, b: string | null) => string> {
  const entry = createRequire(join(API_DIR, 'package.json')).resolve('fractional-indexing');
  const mod = (await import(pathToFileURL(entry).href)) as {
    generateKeyBetween: (a: string | null, b: string | null) => string;
  };
  return mod.generateKeyBetween;
}

/** Move đúng như B mô tả: chỉ `afterId` (không gửi beforeId), status TODO; 429 ⇒ xóa bộ đếm của E2E rồi thử lại. */
async function moveAfter(
  request: APIRequestContext,
  s: Seeded,
  taskId: string,
  afterId: string,
  version: number,
) {
  const send = () =>
    request.fetch(
      `${API_URL}/workspaces/${s.workspaceId}/projects/${s.projectId}/tasks/${taskId}/move`,
      {
        method: 'PATCH',
        headers: {
          origin: WEB_ORIGIN,
          'content-type': 'application/json',
          authorization: `Bearer ${s.accessToken}`,
        },
        data: JSON.stringify({ status: 'TODO', afterId, expectedVersion: version }),
      },
    );
  let res = await send();
  if (res.status() === 429) {
    await flushValkey();
    res = await send();
  }
  return res;
}

test('T-033 rank `~<id>`: N lần chèn L sau R, rồi move X sau R ⇒ không kẹt `~`, tạo task cột đó 201', async ({
  request,
}) => {
  test.setTimeout(300_000);
  const generateKeyBetween = await loadGenerateKeyBetween();
  const user = newUser('tilde');
  const s = await apiRegister(request, user);

  // 1. P, Q, R, X, L1, L2 ⇒ a0..a5.
  const [, , r, x, l1, l2] = [
    await apiCreateTask(request, s, 'Thẻ P'),
    await apiCreateTask(request, s, 'Thẻ Q'),
    await apiCreateTask(request, s, 'Thẻ R'),
    await apiCreateTask(request, s, 'Thẻ X'),
    await apiCreateTask(request, s, 'Thẻ L1'),
    await apiCreateTask(request, s, 'Thẻ L2'),
  ];
  expect((await apiGetTask(request, s, x.id)).rank, 'tiền đề: X ở a3').toBe('a3');

  // 2. N = số lần chèn ngay sau R (giữa a2 và key trước) trước khi lần chèn KẾ TIẾP vượt ngưỡng.
  let prev = 'a3';
  let n = 0;
  for (;;) {
    const cand = generateKeyBetween('a2', prev);
    if (cand.length > THRESHOLD) break;
    prev = cand;
    n += 1;
  }
  expect(n, 'N (B tính được 372)').toBeGreaterThan(0);

  // 3. N lần move luân phiên L1, L2 sau R — mỗi rank ≤ 64 ⇒ chưa rebalance. Token TTL 10s ⇒ đăng nhập lại.
  const versions = new Map<string, number>([
    [l1.id, l1.version],
    [l2.id, l2.version],
  ]);
  let tokenAt = Date.now();
  let simulated = 'a3';
  for (let i = 0; i < n; i += 1) {
    if (Date.now() - tokenAt > 7_000) {
      s.accessToken = (await apiLogin(request, user)).accessToken;
      tokenAt = Date.now();
    }
    const l = i % 2 === 0 ? l1 : l2;
    const res = await moveAfter(request, s, l.id, r.id, versions.get(l.id) ?? 1);
    expect(res.status(), `move L thứ ${String(i)}: ${(await res.text()).slice(0, 200)}`).toBe(200);
    const moved = ((await res.json()) as { data: TaskFull }).data;
    versions.set(moved.id, moved.version);
    simulated = generateKeyBetween('a2', simulated);
    expect(moved.rank, `rank sau move ${String(i)} khớp mô phỏng`).toBe(simulated);
  }

  // 4. Move X sau R ⇒ key mong muốn > 64 ⇒ rebalance; X nhận đúng key cũ 'a3'.
  s.accessToken = (await apiLogin(request, user)).accessToken;
  const xNow = await apiGetTask(request, s, x.id);
  const movedX = await moveAfter(request, s, x.id, r.id, xNow.version);
  expect(movedX.status(), (await movedX.text()).slice(0, 200)).toBe(200);

  // Cổng: X không kẹt rank tạm; tạo task vào cột đó ⇒ 201 (main: 500 "invalid order key head").
  expect
    .soft((await apiGetTask(request, s, x.id)).rank, 'X không được kẹt rank `~<id>`')
    .not.toMatch(/^~/);
  const created = await request.post(
    `${API_URL}/workspaces/${s.workspaceId}/projects/${s.projectId}/tasks`,
    {
      headers: {
        origin: WEB_ORIGIN,
        'content-type': 'application/json',
        authorization: `Bearer ${s.accessToken}`,
      },
      data: JSON.stringify({ title: 'Tạo sau rebalance X' }),
    },
  );
  expect(created.status(), (await created.text()).slice(0, 200)).toBe(201);
});
