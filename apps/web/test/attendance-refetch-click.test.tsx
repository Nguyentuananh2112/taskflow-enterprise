import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { openApp } from '@test/app-harness';
import { FakeRealtimeHub, seedBoard } from '@test/board-harness';
import { startMockApi } from '@test/mock-api';
import { cleanupApp } from '@test/render';

import { getClientId } from '@/shared/lib/client-id';

vi.mock('next/navigation', async () => (await import('@test/navigation')).nextNavigationMock);

// Demo TL (17/10 ~13:52): người vào làm 15/10 (1–14/10 gộp "Bạn bắt đầu làm từ"), vừa chấm vào ⇒ bảng tháng đang
// refetch ⇒ bấm ô 17 trong vài giây đầu mở nhầm "31/10" (31 − 17 = 14 = số ngày bị gộp). Ngày chọn phải là CHUỖI ngày.

let now = Date.parse('2026-10-15T10:00:00+07:00');
let mock: ReturnType<typeof startMockApi>;
beforeAll(() => {
  mock = startMockApi({ now: () => now });
});
afterAll(() => mock.stop());
afterEach(() => cleanupApp());

describe('bảng công: chọn ngày đúng khi có ngày gộp + đang refetch', () => {
  it('gia nhập 15/10, hôm nay 17/10: chấm vào rồi bấm NGAY ô 17 / 15 / 31 ⇒ dialog đúng ngày', async () => {
    const f = seedBoard(mock); // gia nhập 15/10
    now = Date.parse('2026-10-17T13:52:00+07:00');
    f.signInAs(f.owner);
    openApp(
      `/w/${f.wsId}/attendance`,
      new FakeRealtimeHub(mock.board, mock.db).client(getClientId(), f.owner.id),
    );
    const table = await screen.findByRole('table', { name: 'Bảng công tháng 10/2026' });
    expect(screen.getByText('Bạn bắt đầu làm từ 15/10')).toBeTruthy();
    const u = userEvent.setup({ delay: null });
    const box = screen.getByRole('region', { name: /^Hôm nay, / });
    // Chấm vào ⇒ invalidate month/events ⇒ bảng tháng refetch; KHÔNG chờ xong mới bấm.
    void u.click(within(box).getByRole('button', { name: 'Chấm vào' }));
    for (const n of [17, 15, 31]) {
      await u.click(within(table).getByRole('button', { name: new RegExp(`^Ngày ${n}/10`) }));
      const dialog = await screen.findByRole('dialog');
      expect(dialog.querySelector('h2')?.textContent).toMatch(new RegExp(`, ${n}/10$`));
      await u.keyboard('{Escape}');
    }
  });
});
