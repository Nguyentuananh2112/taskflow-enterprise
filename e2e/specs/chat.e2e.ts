import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import type { APIRequestContext, Page } from '@playwright/test';

import { apiCreateUser } from '../support/company';
import { expect, loginViaUi, newUser, test, type E2EUser } from '../support/fixtures';
import { call } from '../support/http';
import { awaiting } from '../support/pending';

// E2E-CH-07 (test-spec-chat §6, avatar-chat.md §7 a11y — phần của H): axe 0 serious / critical sáng + tối ở 360 / 1280;
// vùng `aria-live` sr-only RIÊNG chỉ đọc tin ĐẾN sau lúc mở, `log "Tin nhắn"` không tự đọc. Cần route chat (T-069) +
// event `chat:message:new` thật (T-070) ⇒ fixme tới khi E2E_RUN_PENDING chứa cả hai (không xanh giả).
// Selector theo test-spec-chat §6.1 (H 18/10). E2E-CH-02…06 của F.

const T069 = 'T-069';
const T070 = 'T-070';
const REALTIME = { timeout: 5_000 };

async function seriousViolations(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page }).analyze();
  return result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.impact ?? '?'} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

/** DIRECT giữa hai người + `n` tin của `from` (qua API công khai). */
async function seedDirect(
  request: APIRequestContext,
  from: { token: string },
  toUserId: string,
  bodies: string[],
): Promise<string> {
  const conv = await call<{ id: string }>(
    request,
    'POST',
    '/chat/direct',
    from.token,
    { userId: toUserId },
    201,
  );
  for (const body of bodies) await sendAs(request, from.token, conv.id, body);
  return conv.id;
}

const sendAs = (request: APIRequestContext, token: string, convId: string, body: string) =>
  call(
    request,
    'POST',
    `/chat/conversations/${convId}/messages`,
    token,
    { clientMsgId: randomUUID(), body },
    201,
  );

/** id sau apiCreateUser — thiếu ⇒ ném lỗi rõ (thay vì POST với '' ⇒ 400 khó đọc — F). */
function idOf(user: E2EUser): string {
  if (!user.userId) throw new Error(`${user.email} chưa được tạo (apiCreateUser)`);
  return user.userId;
}

/** Vùng đọc to riêng của luồng tin. */
const liveRegion = (page: Page) => page.locator('[aria-live="polite"].sr-only');

for (const colorScheme of ['light', 'dark'] as const) {
  for (const viewport of [
    { width: 360, height: 780 },
    { width: 1280, height: 800 },
  ]) {
    test.describe(`E2E-CH-07 axe trò chuyện (${colorScheme}, ${viewport.width}px)`, () => {
      test.use({ colorScheme, viewport });
      test.fixme(awaiting(T069, T070), `[PENDING ${T069}, ${T070}] chờ route + realtime chat thật`);

      test('/chat, /chat/[id] (có tin, ảnh đại diện chữ cái), dialog Tin nhắn mới', async ({
        page,
        request,
      }) => {
        const mia = newUser(`ch7-mia-${colorScheme}-${viewport.width}`);
        const vic = newUser(`ch7-vic-${colorScheme}-${viewport.width}`);
        await apiCreateUser(request, mia);
        const v = await apiCreateUser(request, vic);
        const convId = await seedDirect(request, { token: v.accessToken }, idOf(mia), [
          'Chào Mia, xem giúp https://example.com nhé',
          'Tin thứ hai',
        ]);
        await loginViaUi(page, mia);

        await page.goto('/chat');
        await expect(page.getByRole('link', { name: new RegExp(vic.fullName) })).toBeVisible();
        expect(await seriousViolations(page), '/chat').toEqual([]);

        await page.goto(`/chat/${convId}`);
        await expect(
          page.getByRole('log', { name: 'Tin nhắn' }).getByText('Tin thứ hai'),
        ).toBeVisible();
        expect(await seriousViolations(page), '/chat/[id]').toEqual([]);

        await page.goto('/chat');
        await page.getByRole('button', { name: 'Tin nhắn mới' }).click();
        await expect(page.getByRole('dialog', { name: 'Tin nhắn mới' })).toBeVisible();
        expect(await seriousViolations(page), 'dialog Tin nhắn mới').toEqual([]);
      });
    });
  }
}

test.describe('E2E-CH-07 vùng aria-live', () => {
  test.fixme(awaiting(T069, T070), `[PENDING ${T069}, ${T070}] chờ route + realtime chat thật`);

  test('mở luồng KHÔNG đọc lịch sử; tin ĐẾN realtime ⇒ đọc "Vic: …"; tin của mình không đọc; log không tự đọc', async ({
    page,
    request,
  }) => {
    const mia = newUser('ch7-live-mia');
    const vic = newUser('ch7-live-vic');
    await apiCreateUser(request, mia);
    const v = await apiCreateUser(request, vic);
    const convId = await seedDirect(request, { token: v.accessToken }, idOf(mia), ['Lịch sử cũ']);
    await loginViaUi(page, mia);
    await page.goto(`/chat/${convId}`);

    const log = page.getByRole('log', { name: 'Tin nhắn' });
    await expect(log.getByText('Lịch sử cũ')).toBeVisible();
    await expect(log).toHaveAttribute('aria-live', 'off');
    await expect(liveRegion(page)).toHaveText('');

    await page.getByRole('textbox', { name: 'Soạn tin' }).fill('Tin của Mia');
    await page.getByRole('button', { name: 'Gửi' }).click();
    await expect(log.getByText('Tin của Mia')).toBeVisible();
    await expect(liveRegion(page)).toHaveText('');

    await sendAs(request, v.accessToken, convId, 'Có ai không?');
    await expect(log.getByText('Có ai không?')).toBeVisible(REALTIME);
    await expect(liveRegion(page)).toHaveText(`${vic.fullName}: Có ai không?`);
    await expect(page.getByRole('textbox', { name: 'Soạn tin' })).toBeFocused();
  });
});
