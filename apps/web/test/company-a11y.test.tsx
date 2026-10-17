import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { expectNoA11yViolations } from '@test/a11y';
import { openApp } from '@test/app-harness';
import { FakeRealtimeHub, seedBoard } from '@test/board-harness';
import { startMockApi } from '@test/mock-api';
import { cleanupApp } from '@test/render';

import { getClientId } from '@/shared/lib/client-id';

vi.mock('next/navigation', async () => (await import('@test/navigation')).nextNavigationMock);

// T-065d tự soát: axe (0 vi phạm) cho các màn Mốc 3.5 chưa có ca riêng — Quản trị (3 trang) và các hộp thoại nhân
// viên (thêm, cho nghỉ việc). Bố cục 360 px đo ở E2E (jsdom không áp CSS).

let mock: ReturnType<typeof startMockApi>;
beforeEach(() => {
  mock = startMockApi({ now: () => Date.parse('2026-10-15T03:00:00.000Z') });
});
afterEach(() => {
  cleanupApp();
  mock.stop();
});

function open(path: string, access: 'ADMIN' | 'HR') {
  const f = seedBoard(mock);
  f.setCompanyAccess(f.owner, access);
  f.signInAs(f.owner);
  openApp(path, new FakeRealtimeHub(mock.board, mock.db).client(getClientId(), f.owner.id));
  return f;
}

describe('a11y Mốc 3.5', () => {
  it('/admin/access: danh sách phân quyền (select + checkbox + nút theo dòng)', async () => {
    const f = open('/admin/access', 'ADMIN');
    f.addUser('Pam', `pam-${crypto.randomUUID()}@example.com`, 'MEMBER');
    expect(await screen.findByRole('list', { name: 'Phân quyền' })).toBeTruthy();
    await expectNoA11yViolations();
  });

  it('/admin/workspaces có workspace mồ côi + hộp "Giao chủ sở hữu"', async () => {
    const f = seedBoard(mock);
    f.setCompanyAccess(f.owner, 'ADMIN');
    f.addUser('Vic', `vic-${crypto.randomUUID()}@example.com`, 'MEMBER');
    act(() => mock.db.workspaces.removeMember(f.wsId, f.owner.id));
    f.signInAs(f.owner);
    openApp(
      '/admin/workspaces',
      new FakeRealtimeHub(mock.board, mock.db).client(getClientId(), f.owner.id),
    );
    const list = await screen.findByRole('list', { name: 'Danh sách workspace' });
    await expectNoA11yViolations();
    await userEvent
      .setup({ delay: null })
      .click(within(list).getByRole('button', { name: /^Giao chủ sở hữu cho / }));
    await screen.findByRole('dialog', { name: /^Giao chủ sở hữu — / });
    await expectNoA11yViolations();
  });

  it('/admin/company', async () => {
    open('/admin/company', 'ADMIN');
    expect(await screen.findByLabelText(/^Tên công ty/)).toBeTruthy();
    await expectNoA11yViolations();
  });

  it('/hr/employees: hộp "Thêm nhân viên" và "Cho … nghỉ việc"', async () => {
    const f = open('/hr/employees', 'HR');
    f.addUser('Mia Trần', `mia-${crypto.randomUUID()}@example.com`, 'MEMBER');
    const u = userEvent.setup({ delay: null });
    const add = await screen.findByRole('button', { name: 'Thêm nhân viên' });
    await vi.waitFor(() => expect(add.hasAttribute('disabled')).toBe(false));
    await u.click(add);
    await screen.findByRole('dialog', { name: 'Thêm nhân viên' });
    await expectNoA11yViolations();
    await u.click(screen.getByRole('button', { name: 'Hủy' }));
    cleanupApp();

    f.signInAs(f.owner);
    openApp(
      '/hr/employees',
      new FakeRealtimeHub(mock.board, mock.db).client(getClientId(), f.owner.id),
    );
    const row = await screen.findByRole('listitem', { name: 'Mia Trần' });
    await u.click(within(row).getByRole('button', { name: 'Cho Mia Trần nghỉ việc' }));
    await screen.findByRole('dialog', { name: 'Cho Mia Trần nghỉ việc' });
    await expectNoA11yViolations();
  });
});
