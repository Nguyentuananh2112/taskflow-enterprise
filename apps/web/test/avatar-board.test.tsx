import { screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { openApp } from '@test/app-harness';
import { FakeRealtimeHub, openBoard, seedBoard } from '@test/board-harness';
import { startMockApi } from '@test/mock-api';
import { cleanupApp } from '@test/render';

import { getClientId } from '@/shared/lib/client-id';

vi.mock('next/navigation', async () => (await import('@test/navigation')).nextNavigationMock);

// T-071: thẻ task + trang thành viên hiện ảnh (avatar-chat.md ADR-142 — `UserRefDto.avatarUrl` variant 64; E2E-CH-01:
// thẻ board có img alt = họ tên).

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

let mock: ReturnType<typeof startMockApi>;
beforeAll(() => {
  mock = startMockApi({ now: () => Date.parse('2026-10-17T03:00:00.000Z') });
});
afterAll(() => mock.stop());
afterEach(() => cleanupApp());

describe('board — avatar người được giao', () => {
  it('có ảnh ⇒ img alt = họ tên, src variant 64, lazy; người không ảnh ⇒ chữ cái', async () => {
    const f = seedBoard(mock);
    const vic = f.addUser('Vic Phạm', `vic-${crypto.randomUUID()}@example.com`, 'MEMBER');
    mock.avatars.set(f.owner.id, JPEG, 'image/jpeg');
    await f.apiAs(f.owner, 'POST', f.tasksPath, { title: 'Có ảnh', assigneeId: f.owner.id });
    await f.apiAs(f.owner, 'POST', f.tasksPath, { title: 'Không ảnh', assigneeId: vic.id });
    f.signInAs(f.owner);
    openBoard(
      f.boardUrl,
      new FakeRealtimeHub(mock.board, mock.db).client(getClientId(), f.owner.id),
    );

    const withPhoto = (await screen.findByText('Có ảnh')).closest('article') ?? document.body;
    await waitFor(() => {
      const img = within(withPhoto).getByRole('img', { name: f.owner.fullName });
      expect(img.tagName).toBe('IMG');
      expect(img.getAttribute('src')).toContain(`/media/avatars/${f.owner.id}/64?v=1`);
      expect(img.getAttribute('loading')).toBe('lazy');
    });
    const noPhoto = screen.getByText('Không ảnh').closest('article') ?? document.body;
    expect(within(noPhoto).getByRole('img', { name: 'Vic Phạm' }).tagName).toBe('SPAN');
  });
});

describe('trang thành viên — avatar (MemberDto.avatarUrl)', () => {
  it('có ảnh ⇒ img trang trí (alt rỗng) src variant 64 trong dòng; không ảnh ⇒ chữ cái', async () => {
    const f = seedBoard(mock);
    const vic = f.addUser('Vic Phạm', `vic-${crypto.randomUUID()}@example.com`, 'MEMBER');
    mock.avatars.set(vic.id, JPEG, 'image/jpeg');
    f.signInAs(f.owner);
    openApp(
      `/w/${f.wsId}/settings/members`,
      new FakeRealtimeHub(mock.board, mock.db).client(getClientId(), f.owner.id),
    );
    const row = (await screen.findByText('Vic Phạm')).closest('tr') ?? document.body;
    const img = row.querySelector('img[src*="/media/avatars/"]');
    expect(img?.getAttribute('src')).toContain(`/media/avatars/${vic.id}/64?v=1`);
    expect(img?.getAttribute('alt')).toBe('');
    expect(within(row).queryByRole('img', { name: 'Vic Phạm' })).toBeNull();
    const table = row.closest('table') ?? document.body;
    const ownerRow =
      within(table).getAllByText(f.owner.fullName)[0]?.closest('tr') ?? document.body;
    expect(ownerRow.querySelector('img')).toBeNull();
  });
});
