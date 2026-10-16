import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { openApp } from '@test/app-harness';
import { FakeRealtimeHub, seedBoard, type BoardFixture } from '@test/board-harness';
import { startMockApi } from '@test/mock-api';
import { cleanupApp } from '@test/render';

import { getClientId } from '@/shared/lib/client-id';

vi.mock('next/navigation', async () => (await import('@test/navigation')).nextNavigationMock);

// G1 workspace API ↔ web (docs/reviews/G1-workspace-fe.md): đường dự phòng khi KHÔNG có event
// realtime — thay đổi được ghi thẳng vào mock db (không phát socket), như khi socket đang rớt.

let mock: ReturnType<typeof startMockApi>;
let fx: BoardFixture;
let hub: FakeRealtimeHub;

beforeAll(() => {
  mock = startMockApi();
});
afterAll(() => mock.stop());
afterEach(() => cleanupApp());

function fresh() {
  fx = seedBoard(mock);
  hub = new FakeRealtimeHub(mock.board, mock.db);
  return fx;
}
const user = () => userEvent.setup({ delay: null });
const tabFor = (userId: string) => hub.client(getClientId(), userId);

async function openMembersAsOwner() {
  const f = fresh();
  const an = f.addUser('Nguyễn An', 'an@example.com', 'MEMBER');
  f.signInAs(f.owner);
  openApp(`/w/${f.wsId}/settings/members`, tabFor(f.owner.id));
  await screen.findByRole('button', { name: 'Xóa Nguyễn An' });
  return { f, an };
}

describe('W1: chính mình đã mất quyền workspace (404 `workspace`) khi socket rớt', () => {
  it('xóa người khác ⇒ về /w + "không còn truy cập", không nói sai là người kia đã rời', async () => {
    const { f } = await openMembersAsOwner();
    act(() => mock.db.workspaces.removeMember(f.wsId, f.owner.id));
    const u = user();
    await u.click(screen.getByRole('button', { name: 'Xóa Nguyễn An' }));
    await u.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Xóa' }));
    await waitFor(() => expect(window.location.pathname).toBe('/w'));
    expect(await screen.findByText('Bạn không còn truy cập được workspace này')).toBeTruthy();
    expect(screen.queryByText('Người này không còn trong workspace')).toBeNull();
  });

  it('đổi vai trò ⇒ cũng về /w', async () => {
    const { f } = await openMembersAsOwner();
    act(() => void mock.db.workspaces.softDelete(f.wsId));
    await user().selectOptions(
      screen.getByRole('combobox', { name: 'Vai trò của Nguyễn An' }),
      'PM',
    );
    await waitFor(() => expect(window.location.pathname).toBe('/w'));
    expect(await screen.findByText('Bạn không còn truy cập được workspace này')).toBeTruthy();
  });
});

describe('W2: người được thao tác đã bị xóa ở nơi khác (404 `user`)', () => {
  it('xóa ⇒ báo đúng + bảng làm mới (hàng biến mất)', async () => {
    const { f, an } = await openMembersAsOwner();
    act(() => mock.db.workspaces.removeMember(f.wsId, an.id));
    const u = user();
    await u.click(screen.getByRole('button', { name: 'Xóa Nguyễn An' }));
    await u.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Xóa' }));
    expect(await screen.findByText('Người này không còn trong workspace')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Xóa Nguyễn An' })).toBeNull());
    expect(window.location.pathname).toBe(`/w/${f.wsId}/settings/members`);
  });
});

describe('W3: form cài đặt gặp trạng thái cũ ⇒ đọc lại', () => {
  it('dự án vừa bị lưu trữ ở nơi khác ⇒ báo + nút đổi thành "Khôi phục dự án"', async () => {
    const f = fresh();
    f.signInAs(f.owner);
    openApp(`/w/${f.wsId}/p/${f.project.id}/settings`, tabFor(f.owner.id));
    const name = await screen.findByLabelText<HTMLInputElement>(/^Tên dự án/);
    // Trang cài đặt không join phòng project ⇒ không nhận project:updated (frontend.md §3.5).
    await act(() =>
      f.apiAs(f.owner, 'POST', `/workspaces/${f.wsId}/projects/${f.project.id}/archive`),
    );
    expect(screen.getByRole('button', { name: 'Lưu trữ dự án' })).toBeTruthy();
    const u = user();
    await u.type(name, ' mới');
    await u.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    expect(await screen.findByText('Dự án đã lưu trữ — khôi phục trước khi sửa.')).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Khôi phục dự án' })).toBeTruthy();
  });

  it('workspace đã bị xóa ở nơi khác ⇒ lưu ⇒ đọc lại ⇒ màn Không tìm thấy', async () => {
    const f = fresh();
    f.signInAs(f.owner);
    openApp(`/w/${f.wsId}/settings`, tabFor(f.owner.id));
    const name = await screen.findByLabelText<HTMLInputElement>(/^Tên workspace/);
    act(() => void mock.db.workspaces.softDelete(f.wsId));
    const u = user();
    await u.type(name, ' mới');
    await u.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    expect(await screen.findByText('Không tìm thấy hoặc bạn không có quyền truy cập')).toBeTruthy();
  });
});
