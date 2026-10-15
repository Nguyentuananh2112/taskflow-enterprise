import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { expectNoA11yViolations } from '@test/a11y';
import { FakeRealtimeHub, openBoard, seedBoard, type BoardFixture } from '@test/board-harness';
import { startMockApi } from '@test/mock-api';
import { cleanupApp } from '@test/render';

import { getClientId } from '@/shared/lib/client-id';

vi.mock('next/navigation', async () => (await import('@test/navigation')).nextNavigationMock);

// T-025 việc 7: board trên mock API (MSW) + socket giả — cột, thẻ, menu "Chuyển tới", quyền,
// project lưu trữ, realtime, a11y (axe). Kéo bằng chuột/bàn phím cần layout thật ⇒ E2E (§8.2).

let mock: ReturnType<typeof startMockApi>;
let fx: BoardFixture;
let hub: FakeRealtimeHub;

beforeAll(() => {
  mock = startMockApi();
});
afterAll(() => mock.stop());
afterEach(() => cleanupApp());

function freshBoard() {
  fx = seedBoard(mock);
  hub = new FakeRealtimeHub(mock.board);
  return fx;
}

const column = (name: RegExp) => screen.getByRole('region', { name });
/** Thẻ có tên truy cập = tiêu đề task (aria-labelledby). */
const cardIn = (col: HTMLElement, title: string) =>
  within(col).queryByRole('article', { name: title });

describe('board Kanban (OWNER)', () => {
  it('4 cột theo state machine, thẻ đúng cột, a11y không vi phạm', async () => {
    const f = freshBoard();
    const a = await f.createTask('Sửa lỗi header');
    const b = await f.createTask('Trang thanh toán');
    await f.moveTask(b, 'IN_PROGRESS');
    f.signInAs(f.owner);
    openBoard(f.boardUrl, hub.client(getClientId()));

    expect(await screen.findByRole('heading', { level: 1, name: /Dự án đầu tiên/ })).toBeTruthy();
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(2));
    expect(cardIn(column(/Cần làm/), a.title)).toBeTruthy();
    expect(cardIn(column(/Đang làm/), b.title)).toBeTruthy();
    expect(screen.getByRole('button', { name: `Kéo ${a.key}` })).toBeTruthy();
    await expectNoA11yViolations();
  });

  it('menu "⋯" chỉ liệt kê cột hợp lệ; "Chuyển tới Đang làm" gửi đúng payload và thẻ đổi cột', async () => {
    const f = freshBoard();
    const a = await f.createTask('Viết đặc tả');
    f.signInAs(f.owner);
    openBoard(f.boardUrl, hub.client(getClientId()));
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: `Thao tác với ${a.key}` }));
    const items = (await screen.findAllByRole('menuitem')).map((i) => i.textContent);
    expect(items).toEqual(['Chuyển tới Đang làm', 'Lên đầu cột', 'Xuống cuối cột']);
    const requests: string[] = [];
    mock.board.onEvent((e) => requests.push(e.name));
    await user.click(screen.getByRole('menuitem', { name: 'Chuyển tới Đang làm' }));

    await waitFor(() => expect(cardIn(column(/Đang làm/), a.title)).toBeTruthy());
    expect(requests).toEqual(['task:moved']);
    await waitFor(() => expect(mock.board.getTask(f.project.id, a.id)?.status).toBe('IN_PROGRESS'));
  });

  it('tạo nhanh task từ toolbar ⇒ thẻ ở cuối cột Cần làm', async () => {
    const f = freshBoard();
    await f.createTask('Task có sẵn');
    f.signInAs(f.owner);
    openBoard(f.boardUrl, hub.client(getClientId()));
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Task mới'), 'Task vừa tạo');
    await user.click(screen.getByRole('button', { name: 'Tạo task' }));
    await waitFor(() => {
      const titles = within(column(/Cần làm/))
        .getAllByRole('article')
        .map((c) => c.textContent);
      expect(titles.at(-1)).toContain('Task vừa tạo');
    });
  });

  it('realtime: người khác di chuyển task ⇒ thẻ đổi cột không cần tải lại', async () => {
    const f = freshBoard();
    const a = await f.createTask('Việc chung');
    f.signInAs(f.owner);
    const client = hub.client(getClientId());
    openBoard(f.boardUrl, client);
    await screen.findByRole('article', { name: a.title });
    await waitFor(() => expect(client.rooms.has(f.project.id)).toBe(true));

    await act(() => f.moveTask(a, 'IN_PROGRESS')); // tab khác
    await waitFor(() => expect(cardIn(column(/Đang làm/), a.title)).toBeTruthy());
  });

  it('reconnect ⇒ join lại phòng và tải lại board một lần (thay đổi lúc mất mạng xuất hiện)', async () => {
    const f = freshBoard();
    const a = await f.createTask('Việc lúc offline');
    f.signInAs(f.owner);
    const client = hub.client(getClientId());
    openBoard(f.boardUrl, client);
    await screen.findByRole('article', { name: a.title });
    await waitFor(() => expect(client.rooms.size).toBe(1));

    act(() => client.drop());
    await f.moveTask(a, 'IN_PROGRESS'); // event bị lỡ vì đang mất kết nối
    expect(cardIn(column(/Cần làm/), a.title)).toBeTruthy();
    act(() => client.connect());
    await waitFor(() => expect(cardIn(column(/Đang làm/), a.title)).toBeTruthy());
    expect(client.joinLog).toEqual([f.project.id, f.project.id]);
  });

  it('project:join bị từ chối (không còn quyền) ⇒ màn "Không tìm thấy"', async () => {
    const f = freshBoard();
    hub.denyJoin.add(f.project.id);
    f.signInAs(f.owner);
    openBoard(f.boardUrl, hub.client(getClientId()));
    expect(
      await screen.findByRole('heading', {
        name: 'Không tìm thấy hoặc bạn không có quyền truy cập',
      }),
    ).toBeTruthy();
  });
});

describe('quyền & project lưu trữ', () => {
  it('VIEWER: không có tay kéo, menu, ô tạo task; drawer chỉ đọc', async () => {
    const f = freshBoard();
    const a = await f.createTask('Việc để xem');
    const viewer = f.addUser('Vũ Khang', 'khang@example.com', 'VIEWER');
    f.signInAs(viewer);
    openBoard(f.boardUrl, hub.client(getClientId()));

    await screen.findByRole('article', { name: a.title });
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Kéo / })).toBeNull());
    expect(screen.queryByRole('button', { name: /^Thao tác với/ })).toBeNull();
    expect(screen.queryByLabelText('Task mới')).toBeNull();

    await userEvent.setup().click(screen.getByRole('button', { name: a.title }));
    const drawer = await screen.findByRole('dialog', { name: a.key });
    expect(within(drawer).queryByRole('textbox')).toBeNull();
    expect(within(drawer).queryByRole('button', { name: 'Xóa task' })).toBeNull();
    await expectNoA11yViolations();
  });

  it('project lưu trữ: banner chỉ đọc, không kéo; lưu trữ realtime khóa board ngay', async () => {
    const f = freshBoard();
    const a = await f.createTask('Việc cũ');
    f.signInAs(f.owner);
    openBoard(f.boardUrl, hub.client(getClientId()));
    await screen.findByRole('button', { name: `Kéo ${a.key}` });

    await act(() =>
      f.apiAs(f.owner, 'POST', `/workspaces/${f.wsId}/projects/${f.project.id}/archive`),
    );
    expect(await screen.findByText('Dự án đã lưu trữ — chỉ đọc.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: `Kéo ${a.key}` })).toBeNull();
    expect(screen.queryByLabelText('Task mới')).toBeNull();
  });

  it('member:role-changed xuống VIEWER ⇒ tay kéo biến mất ngay', async () => {
    const f = freshBoard();
    const a = await f.createTask('Việc nhóm');
    const member = f.addUser('Mai Hoa', 'hoa@example.com', 'MEMBER');
    f.signInAs(member);
    const client = hub.client(getClientId());
    openBoard(f.boardUrl, client);
    await screen.findByRole('button', { name: `Kéo ${a.key}` });

    act(() =>
      client.emitServer('member:role-changed', {
        eventId: crypto.randomUUID(),
        type: 'member:role-changed',
        occurredAt: new Date().toISOString(),
        actorId: f.owner.id,
        originClientId: null,
        data: { workspaceId: f.wsId, role: 'VIEWER' },
      }),
    );
    await waitFor(() => expect(screen.queryByRole('button', { name: `Kéo ${a.key}` })).toBeNull());
  });
});
