import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { expectNoA11yViolations } from '@test/a11y';
import { openApp } from '@test/app-harness';
import { FakeRealtimeHub, seedBoard } from '@test/board-harness';
import { API_BASE, startMockApi } from '@test/mock-api';
import { cleanupApp } from '@test/render';

import { getClientId } from '@/shared/lib/client-id';

vi.mock('next/navigation', async () => (await import('@test/navigation')).nextNavigationMock);

// T-071: `/hr/employees` "Gỡ ảnh đại diện" (avatar-chat.md ADR-142, SEC-CH-17 phía web, E12 dialog cấp trang).

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

let mock: ReturnType<typeof startMockApi>;
beforeEach(() => {
  mock = startMockApi({ now: () => Date.parse('2026-10-17T03:00:00.000Z') });
});
afterEach(() => {
  cleanupApp();
  mock.stop();
});

function open(access: 'ADMIN' | 'HR') {
  const f = seedBoard(mock);
  f.setCompanyAccess(f.owner, access);
  const mia = f.addUser('Mia Trần', `mia-${crypto.randomUUID()}@example.com`, 'MEMBER');
  const kay = f.addUser('Kay Lê', `kay-${crypto.randomUUID()}@example.com`, 'MEMBER');
  mock.db.company.setAccess(kay.id, 'EMPLOYEE', ['PAYROLL_MANAGE']);
  f.addUser('Nam Võ', `nam-${crypto.randomUUID()}@example.com`, 'MEMBER'); // không có ảnh
  mock.avatars.set(mia.id, JPEG, 'image/jpeg');
  mock.avatars.set(kay.id, JPEG, 'image/jpeg');
  f.signInAs(f.owner);
  openApp(
    '/hr/employees',
    new FakeRealtimeHub(mock.board, mock.db).client(getClientId(), f.owner.id),
  );
  return { f, mia, kay };
}

const removeButton = (name: string) =>
  screen.queryByRole('button', { name: `Gỡ ảnh đại diện ${name}` });

describe('/hr/employees — gỡ ảnh đại diện', () => {
  it('HR: gỡ của nhân viên thường qua dialog cấp trang ⇒ toast, ảnh hết; a11y', async () => {
    const { mia } = open('HR');
    const user = userEvent.setup();
    await screen.findByRole('list', { name: 'Danh sách nhân viên' });
    await user.click(removeButton('Mia Trần')!);
    const dialog = await screen.findByRole('dialog', { name: 'Gỡ ảnh đại diện' });
    expect(dialog.textContent).toContain('Mia Trần');
    await expectNoA11yViolations(dialog);
    await user.click(within(dialog).getByRole('button', { name: 'Gỡ ảnh' }));
    expect(await screen.findByText('Đã gỡ ảnh đại diện của Mia Trần')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mock.avatars.urlOf(mia.id, '64')).toBeNull();
  });

  it('HR: không có nút ở dòng của chính mình và của người giữ grant', async () => {
    const { f } = open('HR');
    await screen.findByRole('list', { name: 'Danh sách nhân viên' });
    expect(removeButton('Mia Trần')).toBeTruthy();
    expect(removeButton('Kay Lê')).toBeNull();
    // Chưa có ảnh (EmployeeDto.avatarUrl thiếu) ⇒ không có nút.
    expect(removeButton('Nam Võ')).toBeNull();
    expect(removeButton(f.owner.fullName)).toBeNull();
  });

  it('Admin: gỡ được người giữ grant, vẫn không có nút ở dòng của chính mình', async () => {
    const admin = open('ADMIN');
    await screen.findByRole('list', { name: 'Danh sách nhân viên' });
    await waitFor(() => expect(removeButton('Kay Lê')).toBeTruthy());
    expect(removeButton(admin.f.owner.fullName)).toBeNull();
  });

  it('server từ chối (403) ⇒ báo trong dialog, không toast; Hủy đóng', async () => {
    const { mia } = open('HR');
    mock.server.use(
      http.delete(
        `${API_BASE}/hr/employees/:userId/avatar`,
        () =>
          HttpResponse.json(
            {
              success: false,
              error: { code: 'FORBIDDEN_ACCESS', message: 'x', details: null },
              meta: { timestamp: '2026-10-17T03:00:00.000Z', requestId: 'r' },
            },
            { status: 403 },
          ),
        { once: true },
      ),
    );
    const user = userEvent.setup();
    await screen.findByRole('list', { name: 'Danh sách nhân viên' });
    await user.click(removeButton('Mia Trần')!);
    const dialog = await screen.findByRole('dialog', { name: 'Gỡ ảnh đại diện' });
    await user.click(within(dialog).getByRole('button', { name: 'Gỡ ảnh' }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      'Bạn không có quyền gỡ ảnh của người này.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Hủy' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mock.avatars.urlOf(mia.id, '64')).not.toBeNull();
  });
});
