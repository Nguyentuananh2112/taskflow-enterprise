import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { expectNoA11yViolations } from '@test/a11y';
import { FakeRealtimeHub, openBoard, seedBoard, type BoardFixture } from '@test/board-harness';
import { startMockApi } from '@test/mock-api';
import { cleanupApp } from '@test/render';

import { getClientId } from '@/shared/lib/client-id';

vi.mock('next/navigation', async () => (await import('@test/navigation')).nextNavigationMock);

// Drawer chi tiết task (T-025 việc 4): sửa + hòa giải 409 (frontend.md §4.6), gán người
// (ADR-041/044), xóa (ADR-022), lịch sử (cursor).

let mock: ReturnType<typeof startMockApi>;
let fx: BoardFixture;

beforeAll(() => {
  mock = startMockApi();
});
afterAll(() => mock.stop());
afterEach(() => cleanupApp());

/** `realtime: false` ⇒ tab không nhận event (mô phỏng event chưa tới) để buộc server trả 409. */
async function openTask(title = 'Sửa lỗi header', realtime = true) {
  fx = seedBoard(mock);
  const task = await fx.createTask(title);
  fx.signInAs(fx.owner);
  const hub = new FakeRealtimeHub(realtime ? mock.board : undefined);
  openBoard(`${fx.boardUrl}?task=${task.id}`, hub.client(getClientId()));
  const drawer = await screen.findByRole('dialog', { name: task.key });
  await within(drawer).findByLabelText(/^Tiêu đề/);
  return { task, drawer, user: userEvent.setup({ delay: null }) };
}

const titleField = (drawer: HTMLElement) =>
  within(drawer).getByLabelText<HTMLInputElement>(/^Tiêu đề/);

describe('drawer chi tiết task', () => {
  it('mở theo ?task=, sửa tiêu đề + lưu; lịch sử có dòng mới; a11y', async () => {
    const { task, drawer, user } = await openTask();
    await expectNoA11yViolations();
    await user.clear(titleField(drawer));
    await user.type(titleField(drawer), 'Sửa lỗi header Safari');
    await user.click(within(drawer).getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() =>
      expect(mock.board.getTask(fx.project.id, task.id)?.title).toBe('Sửa lỗi header Safari'),
    );
    expect(await within(drawer).findByText(/sửa tiêu đề/)).toBeTruthy();
    expect(within(drawer).getByText(/tạo task/)).toBeTruthy();
  });

  it('409 do người khác chỉ KÉO task ⇒ tự rebase, lưu thành công, không hiện khối hòa giải', async () => {
    const { task, drawer, user } = await openTask();
    await user.type(titleField(drawer), ' (gấp)');
    await act(() => fx.moveTask(task, 'IN_PROGRESS')); // tab khác — version tăng
    await user.click(within(drawer).getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => {
      const saved = mock.board.getTask(fx.project.id, task.id);
      expect(saved).toMatchObject({
        title: 'Sửa lỗi header (gấp)',
        status: 'IN_PROGRESS',
        version: 3,
      });
    });
    expect(within(drawer).queryByText(/vừa được người khác sửa/)).toBeNull();
  });

  it('409 cùng sửa tiêu đề ⇒ khối hòa giải; "Giữ bản của tôi" ghi đè có chủ đích', async () => {
    const { task, drawer, user } = await openTask();
    await user.clear(titleField(drawer));
    await user.type(titleField(drawer), 'Bản của tôi');
    await act(() =>
      fx.apiAs(fx.owner, 'PATCH', `${fx.tasksPath}/${task.id}`, {
        expectedVersion: 1,
        title: 'Bản của họ',
      }),
    );
    await user.click(within(drawer).getByRole('button', { name: 'Lưu thay đổi' }));
    const banner = await within(drawer).findByRole('alert');
    expect(banner.textContent).toContain('"Tiêu đề"');
    expect(within(banner).getByText('Bản của họ')).toBeTruthy();
    expect(titleField(drawer).value).toBe('Bản của tôi');
    await user.click(within(banner).getByRole('button', { name: 'Giữ bản của tôi' }));
    await waitFor(() =>
      expect(mock.board.getTask(fx.project.id, task.id)?.title).toBe('Bản của tôi'),
    );
    await waitFor(() => expect(within(drawer).queryByRole('alert')).toBeNull());
  });

  it('"Bỏ thay đổi của tôi" ⇒ form hiện bản mới nhất', async () => {
    const { task, drawer, user } = await openTask();
    await user.type(titleField(drawer), ' — của tôi');
    await act(() =>
      fx.apiAs(fx.owner, 'PATCH', `${fx.tasksPath}/${task.id}`, {
        expectedVersion: 1,
        title: 'Bản của họ',
      }),
    );
    await user.click(within(drawer).getByRole('button', { name: 'Lưu thay đổi' }));
    const banner = await within(drawer).findByRole('alert');
    await user.click(within(banner).getByRole('button', { name: 'Bỏ thay đổi của tôi' }));
    await waitFor(() => expect(titleField(screen.getByRole('dialog')).value).toBe('Bản của họ'));
  });

  it('gán người: picker chỉ có thành viên ≥ MEMBER (không có VIEWER) — ADR-044', async () => {
    fx = seedBoard(mock);
    const hoa = fx.addUser('Mai Hoa', 'hoa@example.com', 'MEMBER');
    fx.addUser('Vũ Khang', 'khang@example.com', 'VIEWER');
    const task = await fx.createTask('Việc cần người');
    fx.signInAs(fx.owner);
    openBoard(
      `${fx.boardUrl}?task=${task.id}`,
      new FakeRealtimeHub(mock.board).client(getClientId()),
    );
    const drawer = await screen.findByRole('dialog', { name: task.key });
    const picker = await within(drawer).findByLabelText<HTMLSelectElement>('Người phụ trách');
    await waitFor(() => expect(picker.options.length).toBe(3));
    expect([...picker.options].map((o) => o.text)).toEqual(['Chưa giao', 'Trần Lan', 'Mai Hoa']);
    await userEvent.setup({ delay: null }).selectOptions(picker, hoa.id);
    await waitFor(() =>
      expect(mock.board.getTask(fx.project.id, task.id)?.assignee?.id).toBe(hoa.id),
    );
  });

  it('MEMBER trên task người khác: chỉ có "Nhận việc" (không có picker), không có nút xóa', async () => {
    fx = seedBoard(mock);
    const an = fx.addUser('Nguyễn An', 'an@example.com', 'MEMBER');
    const task = await fx.createTask('Việc của Lan');
    fx.signInAs(an);
    openBoard(
      `${fx.boardUrl}?task=${task.id}`,
      new FakeRealtimeHub(mock.board).client(getClientId()),
    );
    const drawer = await screen.findByRole('dialog', { name: task.key });
    await within(drawer).findByLabelText(/^Tiêu đề/);
    expect(within(drawer).queryByLabelText('Người phụ trách')).toBeNull();
    expect(within(drawer).queryByRole('button', { name: 'Xóa task' })).toBeNull();
    await userEvent
      .setup({ delay: null })
      .click(within(drawer).getByRole('button', { name: 'Nhận việc' }));
    await waitFor(() =>
      expect(mock.board.getTask(fx.project.id, task.id)?.assignee?.id).toBe(an.id),
    );
    expect(await within(drawer).findByRole('button', { name: 'Bỏ nhận' })).toBeTruthy();
  });

  it('xóa: xác nhận ⇒ thẻ biến mất, drawer đóng', async () => {
    const { task, drawer, user } = await openTask('Việc sẽ xóa');
    await user.click(within(drawer).getByRole('button', { name: 'Xóa task' }));
    const confirm = await screen.findByRole('dialog', { name: `Xóa ${task.key}?` });
    await user.click(within(confirm).getByRole('button', { name: 'Xóa' }));
    await waitFor(() => expect(screen.queryByRole('article', { name: task.title })).toBeNull());
    await waitFor(() => expect(window.location.search).toBe(''));
    expect(mock.board.getTask(fx.project.id, task.id)).toBeUndefined();
  });

  it('xóa khi task vừa bị người khác sửa ⇒ hỏi "Vẫn xóa?"', async () => {
    const { task, drawer, user } = await openTask('Việc bị sửa', false);
    await user.click(within(drawer).getByRole('button', { name: 'Xóa task' }));
    await act(() =>
      fx.apiAs(fx.owner, 'PATCH', `${fx.tasksPath}/${task.id}`, {
        expectedVersion: 1,
        priority: 'HIGH',
      }),
    );
    const confirm = await screen.findByRole('dialog', { name: `Xóa ${task.key}?` });
    await user.click(within(confirm).getByRole('button', { name: 'Xóa' }));
    const again = await screen.findByRole('dialog', { name: 'Task vừa được người khác thay đổi' });
    await user.click(within(again).getByRole('button', { name: 'Vẫn xóa' }));
    await waitFor(() => expect(mock.board.getTask(fx.project.id, task.id)).toBeUndefined());
  });

  it('task bị người khác xóa khi đang mở ⇒ drawer đóng + thông báo', async () => {
    const { task } = await openTask('Việc bị xóa từ xa');
    await act(() => fx.apiAs(fx.owner, 'DELETE', `${fx.tasksPath}/${task.id}?expectedVersion=1`));
    expect(await screen.findByText(`${task.key} vừa bị người khác xóa`)).toBeTruthy();
    await waitFor(() => expect(window.location.search).toBe(''));
  });

  it('deep-link tới task không tồn tại ⇒ "Task không còn tồn tại"', async () => {
    fx = seedBoard(mock);
    fx.signInAs(fx.owner);
    openBoard(
      `${fx.boardUrl}?task=0199e5a2-0000-7000-8000-00000000dead`,
      new FakeRealtimeHub(mock.board).client(getClientId()),
    );
    expect(await screen.findByRole('heading', { name: 'Task không còn tồn tại' })).toBeTruthy();
  });
});
