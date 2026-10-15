import {
  apiAddMember,
  apiCreateTask,
  apiGetTask,
  apiLogin,
  apiMoveBetween,
  apiRegister,
  boardPath,
} from '../support/api';
import { titlesIn, waitBoardReady } from '../support/board';
import { expect, loginViaUi, newUser, test } from '../support/fixtures';
import { openAs } from '../support/users';

// T-033 (rebalance rank) — TL: chèn nhiều lần vào giữa 2 thẻ cố định trong cùng cột ⇒ rank dài dần tới
// ngưỡng 64 ⇒ server rebalance cả cột (task:moved cho các thẻ đổi rank) ⇒ thứ tự trên UI của CẢ HAI người
// vẫn đúng. Chèn qua API công khai (vài trăm lần — kéo bằng tay không thực tế), quan sát bằng UI thật.
const MAX_MOVES = 800;

test('E2E-REBAL: chèn lặp giữa 2 thẻ cố định ⇒ rebalance ⇒ thứ tự đúng trên board A và B (realtime)', async ({
  page,
  browser,
  request,
}) => {
  test.setTimeout(240_000);
  const a = newUser('rebal-a');
  const b = newUser('rebal-b');
  const sa = await apiRegister(request, a);
  await apiRegister(request, b);
  await apiAddMember(request, sa, b, 'MEMBER');
  const [l, p, q, r] = [
    await apiCreateTask(request, sa, 'Neo trái'),
    await apiCreateTask(request, sa, 'Thẻ P'),
    await apiCreateTask(request, sa, 'Thẻ Q'),
    await apiCreateTask(request, sa, 'Neo phải'),
  ];
  await loginViaUi(page, a);
  await page.goto(boardPath(sa));
  await waitBoardReady(page);
  const userB = await openAs(browser, b);
  await userB.page.goto(boardPath(sa));
  await waitBoardReady(userB.page);

  // Lần lượt đưa Q, P vào sát sau "Neo trái": khe ngay sau L hẹp dần ⇒ rank dài dần.
  let longest = 0;
  let rebalancedAt = -1;
  let front = p; // thẻ đang đứng ngay sau L
  let back = q;
  const versions = new Map<string, number>([
    [p.id, p.version],
    [q.id, q.version],
  ]);
  // Suite chạy access token TTL 10s (E2E-11) ⇒ vòng lặp dài tự đăng nhập lại qua API mỗi 7s.
  let tokenAt = Date.now();
  for (let i = 0; i < MAX_MOVES && rebalancedAt < 0; i += 1) {
    if (Date.now() - tokenAt > 7_000) {
      sa.accessToken = (await apiLogin(request, a)).accessToken;
      tokenAt = Date.now();
    }
    const moved = await apiMoveBetween(request, sa, back.id, l.id, front.id, versions.get(back.id));
    versions.set(moved.id, moved.version);
    if (moved.rank.length < longest / 2) rebalancedAt = i;
    longest = Math.max(longest, moved.rank.length);
    [front, back] = [back, front];
  }
  expect(
    rebalancedAt,
    `không thấy rebalance sau ${String(MAX_MOVES)} lần (rank dài nhất ${String(longest)})`,
  ).toBeGreaterThan(0);
  // Server rebalance khi rank MỚI dài hơn 64 ⇒ rank dài nhất client nhận được đúng bằng ngưỡng.
  expect(longest, 'rank phải chạm ngưỡng 64 trước khi rebalance').toBeGreaterThanOrEqual(64);

  // Thứ tự đúng theo server: L, front, back, R (front vừa được chèn sát sau L ở bước cuối = `back` trước khi đổi).
  const expected = [
    'Neo trái',
    front.id === p.id ? 'Thẻ P' : 'Thẻ Q',
    front.id === p.id ? 'Thẻ Q' : 'Thẻ P',
    'Neo phải',
  ];
  await expect.poll(() => titlesIn(page, 'TODO'), { timeout: 10_000 }).toEqual(expected);
  await expect.poll(() => titlesIn(userB.page, 'TODO'), { timeout: 10_000 }).toEqual(expected);
  // Tải lại = thứ tự từ DB, không phải từ cache realtime.
  await page.reload();
  await waitBoardReady(page);
  await expect.poll(() => titlesIn(page, 'TODO')).toEqual(expected);
  expect(r.id).toBeTruthy();

  // Không task nào được kẹt rank tạm pha 1 của rebalance (`~<id>`).
  for (const t of [l, p, q, r]) {
    expect((await apiGetTask(request, sa, t.id)).rank, `rank của ${t.key}`).not.toMatch(/^~/);
  }

  // HIGH (B tìm, A sửa): rebalance cùng cột từng để lại rank tạm `~<id>` ⇒ tạo task mới ở cột đó 500.
  // Tạo qua UI thật: phải 201 và nằm CUỐI cột, thứ tự cũ giữ nguyên.
  const created = page.waitForResponse(
    (res) => /\/tasks$/.test(res.url()) && res.request().method() === 'POST',
  );
  await page.getByLabel('Task mới', { exact: true }).fill('Tạo sau rebalance');
  await page.getByRole('button', { name: 'Tạo task' }).click();
  const res = await created;
  expect(res.status(), await res.text()).toBe(201);
  await expect.poll(() => titlesIn(page, 'TODO')).toEqual([...expected, 'Tạo sau rebalance']);
  await userB.close();
});
