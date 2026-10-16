import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { expectNoA11yViolations } from '@test/a11y';
import { openApp } from '@test/app-harness';
import { FakeRealtimeHub, seedBoard } from '@test/board-harness';
import { API_BASE, startMockApi } from '@test/mock-api';
import { cleanupApp } from '@test/render';

import { getClientId } from '@/shared/lib/client-id';

vi.mock('next/navigation', async () => (await import('@test/navigation')).nextNavigationMock);

// T-041c: công tắc "Quản lý nhân sự" (ADR-119) trong cài đặt thành viên — chỉ OWNER thấy (`hr:grant`);
// OWNER "Luôn có", VIEWER "Không áp dụng"; cấp hỏi lại (mở dữ liệu nhạy cảm), thu làm ngay.

let mock: ReturnType<typeof startMockApi>;
beforeAll(() => {
  mock = startMockApi();
});
afterAll(() => mock.stop());
afterEach(() => cleanupApp());

const user = () => userEvent.setup({ delay: null });

/** Mã HTTP của PUT grants (apiAs của harness không trả status). */
async function putGrants(by: { id: string }, path: string, grants: string[]) {
  const actor = mock.db.getUser(by.id);
  if (!actor) throw new Error('user không tồn tại');
  const response = await getResponse(
    mock.handlers,
    new Request(API_BASE + path, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${mock.db.issueAccess(actor).accessToken}`,
      },
      body: JSON.stringify({ grants }),
    }),
  );
  return response?.status;
}

function fresh() {
  const f = seedBoard(mock);
  const hub = new FakeRealtimeHub(mock.board, mock.db);
  return { f, hub, tabFor: (id: string) => hub.client(getClientId(), id) };
}

describe('công tắc Quản lý nhân sự', () => {
  it('OWNER cấp (xác nhận) rồi thu; OWNER bật + khóa, VIEWER tắt + khóa, có chú thích; a11y', async () => {
    const { f, tabFor } = fresh();
    const an = f.addUser('Nguyễn An', 'an@example.com', 'MEMBER');
    f.addUser('Khách Vy', 'vy@example.com', 'VIEWER');
    f.signInAs(f.owner);
    openApp(`/w/${f.wsId}/settings/members`, tabFor(f.owner.id));
    const sw = await screen.findByRole('switch', { name: 'Quản lý nhân sự: Nguyễn An' });
    expect(screen.getByRole('columnheader', { name: 'Quản lý nhân sự' })).toBeTruthy();
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(sw.getAttribute('aria-disabled')).toBeNull();
    const ownerSw = screen.getByRole('switch', { name: 'Quản lý nhân sự: Trần Lan' });
    expect(ownerSw.getAttribute('aria-checked')).toBe('true');
    expect(ownerSw.getAttribute('aria-disabled')).toBe('true');
    expect(
      document.getElementById(ownerSw.getAttribute('aria-describedby') ?? '')?.textContent,
    ).toBe('Chủ sở hữu luôn có quyền Quản lý nhân sự');
    const viewerSw = screen.getByRole('switch', { name: 'Quản lý nhân sự: Khách Vy' });
    expect(viewerSw.getAttribute('aria-checked')).toBe('false');
    expect(viewerSw.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('Người xem không được cấp quyền Quản lý nhân sự')).toBeTruthy();
    await expectNoA11yViolations();

    const u = user();
    await u.click(viewerSw);
    await u.click(ownerSw);
    expect(screen.queryByRole('dialog')).toBeNull();
    await u.click(sw);
    const dialog = await screen.findByRole('dialog', {
      name: /Cấp quyền Quản lý nhân sự cho Nguyễn An/,
    });
    expect(dialog.textContent).toMatch(/lý do nghỉ/);
    await u.click(within(dialog).getByRole('button', { name: 'Cấp quyền' }));
    expect(await screen.findByText('Nguyễn An đã có quyền Quản lý nhân sự')).toBeTruthy();
    await waitFor(() => expect(sw.getAttribute('aria-checked')).toBe('true'));
    expect(mock.db.workspaces.member(f.wsId, an.id)?.grants).toEqual(['HR_MANAGE']);

    await u.click(sw);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await screen.findByText('Đã thu quyền Quản lý nhân sự của Nguyễn An')).toBeTruthy();
    await waitFor(() => expect(sw.getAttribute('aria-checked')).toBe('false'));
    expect(mock.db.workspaces.member(f.wsId, an.id)?.grants).toEqual([]);
  });

  it('PM không thấy cột; server vẫn chặn PUT grants (403) và cấp cho VIEWER (422)', async () => {
    const { f, tabFor } = fresh();
    const pm = f.addUser('Quản Lý', 'pm@example.com', 'PM');
    const vy = f.addUser('Khách Vy', 'vy@example.com', 'VIEWER');
    f.signInAs(pm);
    openApp(`/w/${f.wsId}/settings/members`, tabFor(pm.id));
    await screen.findByRole('cell', { name: /Khách Vy/ });
    expect(screen.queryByRole('columnheader', { name: 'Quản lý nhân sự' })).toBeNull();
    expect(screen.queryByRole('switch')).toBeNull();
    const path = `/workspaces/${f.wsId}/members/${vy.id}/grants`;
    expect(await putGrants(pm, path, ['HR_MANAGE'])).toBe(403);
    expect(await putGrants(f.owner, path, ['HR_MANAGE'])).toBe(422);
  });

  it('được cấp ⇒ myGrants đổi ngay qua member:grants-changed; hạ xuống Người xem ⇒ grants bị xóa', async () => {
    const { f, tabFor } = fresh();
    const an = f.addUser('Nguyễn An', 'an@example.com', 'MEMBER');
    f.signInAs(an);
    const tab = tabFor(an.id);
    openApp(`/w/${f.wsId}/settings/members`, tab);
    await screen.findByRole('cell', { name: /Nguyễn An/ });
    await act(() =>
      f.apiAs(f.owner, 'PUT', `/workspaces/${f.wsId}/members/${an.id}/grants`, {
        grants: ['HR_MANAGE'],
      }),
    );
    await waitFor(() =>
      expect((mock.db.workspaces.member(f.wsId, an.id)?.grants ?? []).includes('HR_MANAGE')).toBe(
        true,
      ),
    );
    await act(() =>
      f.apiAs(f.owner, 'PATCH', `/workspaces/${f.wsId}/members/${an.id}`, { role: 'VIEWER' }),
    );
    expect(mock.db.workspaces.member(f.wsId, an.id)?.grants).toEqual([]);
  });
});
