import { MemberGrantsChangedEvent } from '@taskflow/contracts/realtime';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { expectNoA11yViolations } from '@test/a11y';
import { openApp } from '@test/app-harness';
import { FakeRealtimeHub, seedBoard } from '@test/board-harness';
import { startMockApi } from '@test/mock-api';
import { cleanupApp } from '@test/render';

import { userRoom } from '@/app/mock-api/workspace-events';
import { getClientId } from '@/shared/lib/client-id';

vi.mock('next/navigation', async () => (await import('@test/navigation')).nextNavigationMock);

// T-041a: chuông thông báo (ADR-123, E2E-HR-02/08) + `member:grants-changed` (E2E-HR-03).

let mock: ReturnType<typeof startMockApi>;
beforeAll(() => {
  mock = startMockApi();
});
afterAll(() => mock.stop());
afterEach(() => cleanupApp());

function open() {
  const f = seedBoard(mock);
  const hub = new FakeRealtimeHub(mock.board, mock.db);
  f.signInAs(f.owner);
  openApp(`/w/${f.wsId}/projects`, hub.client(getClientId(), f.owner.id));
  const notify = (
    fullName = 'Hana HR',
    type: 'LEAVE_APPROVED' | 'LEAVE_SUBMITTED' = 'LEAVE_APPROVED',
  ) =>
    mock.notifications.notify(f.owner.id, {
      type,
      refId: crypto.randomUUID(),
      workspaceId: f.wsId,
      workspaceName: 'Công ty Lan',
      actor: { id: crypto.randomUUID(), fullName },
      leave: { type: 'ANNUAL', startDate: '2026-10-20', endDate: '2026-10-21' },
    });
  return { f, notify };
}

const bell = () => screen.getByRole('button', { name: /^Thông báo/ });

describe('chuông thông báo', () => {
  it('số chưa đọc ⇒ danh sách câu chữ dựng ở web ⇒ link tới đúng trang, bấm ⇒ đã đọc; a11y', async () => {
    const { f, notify } = open();
    notify();
    await waitFor(() => expect(bell().getAttribute('aria-label')).toBe('Thông báo, 1 chưa đọc'));
    const u = userEvent.setup({ delay: null });
    await u.click(bell());
    const panel = await screen.findByRole('dialog', { name: 'Thông báo' });
    const item = await within(panel).findByRole('link', {
      name: /Chưa đọc: Đơn nghỉ phép năm 20\/10–21\/10 của bạn đã được duyệt/,
    });
    expect(item.textContent).toContain('Công ty Lan');
    // jsdom không điều hướng <Link> của Next ⇒ kiểm đích + hiệu ứng đánh dấu đã đọc.
    expect(item.getAttribute('href')).toBe(`/w/${f.wsId}/leave`);
    await expectNoA11yViolations();
    await u.click(item);
    await waitFor(() => expect(bell().getAttribute('aria-label')).toBe('Thông báo'));
  });

  it('realtime: thông báo mới ⇒ số tăng ngay, không reload', async () => {
    const { notify } = open();
    await waitFor(() => expect(bell().getAttribute('aria-label')).toBe('Thông báo'));
    act(() => void notify('Mia', 'LEAVE_SUBMITTED'));
    await waitFor(() => expect(bell().getAttribute('aria-label')).toBe('Thông báo, 1 chưa đọc'));
  });

  it('tên người chứa HTML ⇒ hiển thị như chữ (E2E-HR-08)', async () => {
    const { notify } = open();
    notify('<img src=x onerror=alert(1)>', 'LEAVE_SUBMITTED');
    await userEvent
      .setup({ delay: null })
      .click(await screen.findByRole('button', { name: /chưa đọc/ }));
    const panel = await screen.findByRole('dialog', { name: 'Thông báo' });
    expect(
      await within(panel).findByText(/<img src=x onerror=alert\(1\)> gửi đơn nghỉ/),
    ).toBeTruthy();
    expect(panel.querySelector('img')).toBeNull();
  });
});

describe('thông báo dành cho HR (§9 B-H3)', () => {
  it('người không còn hr:manage ⇒ không thấy LEAVE_SUBMITTED/CANCELLED, vẫn thấy thông báo của mình', async () => {
    const f = seedBoard(mock);
    const mia = f.addUser('Mia', `mia-${crypto.randomUUID()}@example.com`, 'MEMBER');
    const base = {
      refId: crypto.randomUUID(),
      workspaceId: f.wsId,
      workspaceName: 'Công ty Lan',
      actor: { id: f.owner.id, fullName: 'Lan' },
      leave: { type: 'ANNUAL', startDate: '2026-10-20', endDate: '2026-10-21' },
    } as const;
    for (const type of ['LEAVE_SUBMITTED', 'LEAVE_CANCELLED', 'LEAVE_APPROVED'] as const) {
      mock.notifications.notify(mia.id, { ...base, type });
    }
    f.signInAs(mia);
    openApp(
      `/w/${f.wsId}/projects`,
      new FakeRealtimeHub(mock.board, mock.db).client(getClientId(), mia.id),
    );
    await waitFor(() => expect(bell().getAttribute('aria-label')).toBe('Thông báo, 1 chưa đọc'));
    await userEvent.setup({ delay: null }).click(bell());
    const panel = await screen.findByRole('dialog', { name: 'Thông báo' });
    expect(await within(panel).findAllByRole('link')).toHaveLength(1);
    expect(within(panel).queryByText(/gửi đơn nghỉ/)).toBeNull();
  });
});

describe('member:grants-changed', () => {
  it('được cấp HR ⇒ báo ngay (usePermission đổi theo myGrants, không reload)', async () => {
    const { f } = open();
    await screen.findByRole('region', { name: 'Chấm công' });
    act(() =>
      mock.board.publish({
        room: userRoom(f.owner.id),
        name: 'member:grants-changed',
        payload: MemberGrantsChangedEvent.parse({
          eventId: crypto.randomUUID(),
          type: 'member:grants-changed',
          occurredAt: new Date().toISOString(),
          actorId: f.owner.id,
          originClientId: null,
          data: { workspaceId: f.wsId, grants: ['HR_MANAGE'] },
        }),
      }),
    );
    expect(await screen.findByText('Bạn được cấp quyền Quản lý nhân sự')).toBeTruthy();
  });
});
