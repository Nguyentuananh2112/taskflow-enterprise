import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { expectNoA11yViolations } from '@test/a11y';
import { openApp } from '@test/app-harness';
import { FakeRealtimeHub, seedBoard } from '@test/board-harness';
import { startMockApi } from '@test/mock-api';
import { cleanupApp } from '@test/render';

import { getClientId } from '@/shared/lib/client-id';

vi.mock('next/navigation', async () => (await import('@test/navigation')).nextNavigationMock);

// T-065a (ADR-139): header công ty ở MỌI trang — ≥ md hàng link (Trang chính + việc quản lý theo quyền), < md nút ☰ với
// đủ mục; trang chính có dải "Bạn làm việc tới hết ngày …" khi có lịch nghỉ việc (E A6). Quyền từ `/auth/me`.

let mock: ReturnType<typeof startMockApi>;
beforeEach(() => {
  mock = startMockApi({ now: () => Date.parse('2026-10-15T03:00:00.000Z') });
});
afterEach(() => {
  cleanupApp();
  mock.stop();
});

function open(access: 'EMPLOYEE' | 'HR' | 'ADMIN', path = '/w') {
  const f = seedBoard(mock);
  f.setCompanyAccess(f.owner, access);
  f.signInAs(f.owner);
  openApp(path, new FakeRealtimeHub(mock.board, mock.db).client(getClientId(), f.owner.id));
  return f;
}

/** Mở ☰ (jsdom không áp CSS ⇒ nút hiện ở mọi bề rộng) và trả danh sách nhãn trong menu. */
async function menuLabels() {
  await userEvent.setup({ delay: null }).click(await screen.findByRole('button', { name: 'Menu' }));
  const menu = await screen.findByRole('navigation', { name: 'Menu' });
  return within(menu)
    .getAllByRole('link')
    .map((l) => [l.textContent, l.getAttribute('href')]);
}

describe('header công ty', () => {
  it('nhân viên: ☰ có Trang chính · Bảng công · Nghỉ phép · Hồ sơ của tôi; hàng link ≥ md chỉ Trang chính; a11y', async () => {
    open('EMPLOYEE');
    await screen.findByRole('region', { name: 'Chấm công' });
    const links = within(screen.getByRole('navigation', { name: 'Công ty' })).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(['Trang chính']);
    expect(links[0]?.getAttribute('aria-current')).toBe('page');
    expect(await menuLabels()).toEqual([
      ['Trang chính', '/w'],
      ['Bảng công của tôi', '/attendance'],
      ['Nghỉ phép', '/leave'],
      ['Hồ sơ của tôi', '/my-profile'],
    ]);
    expect(screen.getByRole('button', { name: 'Menu' }).getAttribute('aria-expanded')).toBe('true');
    await expectNoA11yViolations();
  });

  it('HR: thêm "Nhân sự" (cả hàng link ≥ md); Admin: "Nhân sự" + "Quản trị", KHÔNG có mục chấm công / nghỉ phép', async () => {
    open('HR');
    await screen.findByRole('region', { name: 'Chấm công' });
    expect(await menuLabels()).toContainEqual(['Nhân sự', '/hr']);
    expect(
      within(screen.getByRole('navigation', { name: 'Công ty' }))
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Trang chính', 'Nhân sự']);
    cleanupApp();

    open('ADMIN');
    await screen.findByRole('heading', { name: 'Việc quản lý' });
    expect(await menuLabels()).toEqual([
      ['Trang chính', '/w'],
      ['Nhân sự', '/hr'],
      ['Quản trị', '/admin'],
    ]);
  });

  it('Esc đóng ☰ và trả focus về nút; header có trên trang công ty (không wsId)', async () => {
    open('EMPLOYEE', '/leave');
    await screen.findByRole('heading', { name: 'Nghỉ phép' });
    await menuLabels();
    await userEvent.setup({ delay: null }).keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('navigation', { name: 'Menu' })).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Menu' }));
  });
});

describe('trang chính', () => {
  it('có lịch nghỉ việc ⇒ dải "Bạn làm việc tới hết ngày dd/mm/yyyy" (status OFFBOARDING từ /auth/me)', async () => {
    const f = seedBoard(mock);
    mock.db.company.setOffboarding(f.owner.id, '2026-10-31');
    f.signInAs(f.owner);
    openApp('/w', new FakeRealtimeHub(mock.board, mock.db).client(getClientId(), f.owner.id));
    expect(await screen.findByText(/Bạn làm việc tới hết ngày 31\/10\/2026\./)).toBeTruthy();
  });

  it('thứ tự: thẻ chấm công → lối tắt → "Workspace của bạn" (+ Tạo workspace)', async () => {
    open('EMPLOYEE');
    const card = await screen.findByRole('region', { name: 'Chấm công' });
    const shortcuts = await screen.findByRole('navigation', {
      name: 'Lối tắt chấm công và nghỉ phép',
    });
    const workspaces = screen.getByRole('region', { name: 'Workspace của bạn' });
    const follows = (a: Element, b: Element) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(card, shortcuts) && follows(shortcuts, workspaces)).toBe(true);
    expect(within(workspaces).getByRole('link', { name: 'Tạo workspace' })).toBeTruthy();
  });
});
