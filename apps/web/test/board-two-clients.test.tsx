import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';

import { FakeRealtimeHub, openBoard, seedBoard } from '@test/board-harness';
import { startMockApi } from '@test/mock-api';
import { cleanupApp } from '@test/render';

import { getClientId } from '@/shared/lib/client-id';

vi.mock('next/navigation', async () => (await import('@test/navigation')).nextNavigationMock);

// T-025 việc 7 — luồng tích hợp 2 client: hai "tab" mở cùng board (mỗi tab một QueryClient + một
// socket giả, clientId khác nhau). A di chuyển thẻ ⇒ B thấy thẻ đổi cột qua event realtime (không
// refetch); A bỏ qua event của chính mình (originClientId). Kéo chuột thật để E2E; ở đây A dùng
// menu "Chuyển tới" — cùng đường useMoveTask với kéo thả.

let mock: ReturnType<typeof startMockApi>;
beforeAll(() => {
  mock = startMockApi();
});
afterAll(() => mock.stop());
afterEach(() => cleanupApp());

it('A chuyển thẻ sang Đang làm ⇒ B thấy ngay; B tạo task ⇒ A thấy', async () => {
  const fx = seedBoard(mock);
  const task = await fx.createTask('Thiết kế màn hình đăng nhập');
  fx.signInAs(fx.owner);
  const hub = new FakeRealtimeHub(mock.board);
  const clientA = hub.client(getClientId()); // tab A: X-Client-Id thật của `http`
  const clientB = hub.client(); // tab B: clientId khác
  const tabA = openBoard(fx.boardUrl, clientA).container;
  const tabB = openBoard(fx.boardUrl, clientB).container;

  const columnOf = (tab: HTMLElement, name: RegExp) => within(tab).getByRole('region', { name });
  await within(tabA).findByRole('article', { name: task.title });
  await within(tabB).findByRole('article', { name: task.title });
  await waitFor(() => expect([clientA.rooms.size, clientB.rooms.size]).toEqual([1, 1]));
  // Đếm lần tải lại board (GET …/tasks?limit=…) — realtime phải cập nhật mà không refetch.
  const fetchSpy = vi.spyOn(globalThis, 'fetch');
  const boardFetches = () =>
    fetchSpy.mock.calls.filter(([input, init]) => {
      const url = input instanceof Request ? input.url : String(input);
      return (init?.method ?? 'GET') === 'GET' && /\/tasks\?/.test(url);
    }).length;

  const user = userEvent.setup();
  await user.click(within(tabA).getByRole('button', { name: `Thao tác với ${task.key}` }));
  await user.click(await screen.findByRole('menuitem', { name: 'Chuyển tới Đang làm' }));

  // B nhận task:moved qua socket ⇒ thẻ sang cột Đang làm.
  await waitFor(() =>
    expect(
      within(columnOf(tabB, /Đang làm/)).queryByRole('article', { name: task.title }),
    ).toBeTruthy(),
  );
  expect(within(columnOf(tabB, /Cần làm/)).queryByRole('article', { name: task.title })).toBeNull();
  expect(
    within(columnOf(tabA, /Đang làm/)).queryByRole('article', { name: task.title }),
  ).toBeTruthy();
  expect(fetchSpy).toHaveBeenCalled(); // spy thật sự thấy request (PATCH move của A)
  expect(boardFetches()).toBe(0);

  // B tạo task (request của tab B mang clientId của B) ⇒ A thấy.
  await act(() =>
    fx.apiAs(fx.owner, 'POST', fx.tasksPath, { title: 'Task do B tạo' }, clientB.clientId),
  );
  await waitFor(() =>
    expect(
      within(columnOf(tabA, /Cần làm/)).queryByRole('article', { name: 'Task do B tạo' }),
    ).toBeTruthy(),
  );
  expect(boardFetches()).toBe(0);
  fetchSpy.mockRestore();
});
