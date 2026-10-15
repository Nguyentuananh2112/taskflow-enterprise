import type { TaskDto } from '@taskflow/contracts/task';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PROJECT_ID, WS_ID, makeTask } from '@test/task-fixture';

import { boardFromTasks, taskApi, taskKeys, type BoardData } from '@/entities/task';
import { ApiError } from '@/shared/api';
import { createQueryClient } from '@/shared/query';
import { resetToastsForTest } from '@/shared/ui/toast';
import { toastStore } from '@/shared/ui/toast/toast-store';

import { optimisticTask, useMoveTask, usePendingMoveIds } from './use-move-task';

// Bảng lỗi của frontend.md §4.4 + rollback có điều kiện theo từng task.

const scope = { wsId: WS_ID, projectId: PROJECT_ID };
const boardKey = taskKeys.board(WS_ID, PROJECT_ID);

function setup(tasks: TaskDto[]) {
  const client = createQueryClient();
  client.setQueryData(boardKey, boardFromTasks(tasks));
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => ({ move: useMoveTask(scope), pending: usePendingMoveIds() }), {
    wrapper,
  });
  const board = () => client.getQueryData<BoardData>(boardKey) as BoardData;
  return { client, hook, board };
}

const apiError = (status: number, code: ApiError['code'], details: unknown = null) =>
  new ApiError({ status, code, message: code, details });

const toastTitles = () => toastStore.getSnapshot().map((t) => t.title);

afterEach(() => {
  vi.restoreAllMocks();
  resetToastsForTest();
});

describe('useMoveTask — optimistic theo từng task', () => {
  const a = makeTask({ key: 'TF-1', status: 'TODO', rank: 'a0', version: 1 });
  const b = makeTask({ key: 'TF-2', status: 'IN_PROGRESS', rank: 'a0', version: 1 });
  const intent = { status: 'IN_PROGRESS' as const, afterId: b.id, beforeId: null };

  it('áp optimistic ngay (giữ version cũ), khóa thẻ khi chờ, rồi nhận bản server', async () => {
    let resolve!: (t: TaskDto) => void;
    const spy = vi
      .spyOn(taskApi, 'move')
      .mockImplementation(() => new Promise<TaskDto>((r) => (resolve = r)));
    const { hook, board } = setup([a, b]);
    act(() => hook.result.current.move.mutate({ base: a, intent }));
    await waitFor(() => expect(board().byId[a.id]?.status).toBe('IN_PROGRESS'));
    expect(board().byId[a.id]?.version).toBe(1);
    expect(board().byId[a.id]!.rank > 'a0').toBe(true);
    await waitFor(() => expect(hook.result.current.pending.has(a.id)).toBe(true));
    expect(spy).toHaveBeenCalledWith(scope, a.id, {
      expectedVersion: 1,
      status: 'IN_PROGRESS',
      afterId: b.id,
      beforeId: null,
    });
    const server = { ...a, status: 'IN_PROGRESS' as const, rank: 'a1', version: 2 };
    await act(async () => {
      resolve(server);
      await Promise.resolve();
    });
    await waitFor(() => expect(board().byId[a.id]).toEqual(server));
    expect(hook.result.current.pending.size).toBe(0);
  });

  it('409, người khác CHỈ sửa nội dung ⇒ tự gửi lại đúng 1 lần với version mới', async () => {
    const current = { ...a, title: 'đổi tên', version: 2 };
    const spy = vi
      .spyOn(taskApi, 'move')
      .mockRejectedValueOnce(apiError(409, 'VERSION_CONFLICT', { currentVersion: 2, current }))
      .mockResolvedValueOnce({ ...current, status: 'IN_PROGRESS', rank: 'a1', version: 3 });
    const { hook, board } = setup([a, b]);
    await act(() => hook.result.current.move.mutateAsync({ base: a, intent }));
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[1]?.[2]).toMatchObject({ expectedVersion: 2 });
    expect(board().byId[a.id]).toMatchObject({ version: 3, title: 'đổi tên' });
  });

  it('409, người khác đã DI CHUYỂN task ⇒ hiện vị trí thật, không gửi lại', async () => {
    const current = { ...a, status: 'IN_PROGRESS' as const, rank: 'Z0', version: 2 };
    const spy = vi
      .spyOn(taskApi, 'move')
      .mockRejectedValue(apiError(409, 'VERSION_CONFLICT', { currentVersion: 2, current }));
    const { hook, board } = setup([a, b]);
    await act(() => hook.result.current.move.mutateAsync({ base: a, intent }).catch(() => null));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(board().byId[a.id]).toEqual(current);
    expect(toastTitles()).toContain('TF-1 vừa được người khác cập nhật');
  });

  it.each([
    [
      '422 INVALID_STATUS_TRANSITION',
      apiError(422, 'INVALID_STATUS_TRANSITION', {
        from: 'TODO',
        to: 'DONE',
        allowed: ['IN_PROGRESS'],
      }),
      'Không thể chuyển sang Hoàn thành',
    ],
    [
      '422 PROJECT_ARCHIVED',
      apiError(422, 'PROJECT_ARCHIVED', { projectId: PROJECT_ID }),
      'Dự án đã được lưu trữ — chỉ đọc',
    ],
    [
      '422 INVALID_ANCHOR',
      apiError(422, 'BUSINESS_RULE_VIOLATION', { rule: 'INVALID_ANCHOR' }),
      'Bảng vừa thay đổi',
    ],
    [
      '409 RESOURCE_CONFLICT',
      apiError(409, 'RESOURCE_CONFLICT', { reason: 'rank' }),
      'Bảng vừa thay đổi',
    ],
    ['403', apiError(403, 'FORBIDDEN_ACCESS'), 'Bạn không có quyền thực hiện thao tác này'],
    ['mạng', apiError(0, 'NETWORK_ERROR'), 'Không lưu được thay đổi'],
    ['5xx', apiError(500, 'INTERNAL_ERROR'), 'Không lưu được thay đổi'],
  ])('%s ⇒ rollback về base + toast', async (_name, error, title) => {
    vi.spyOn(taskApi, 'move').mockRejectedValue(error);
    const { hook, board } = setup([a, b]);
    await act(() => hook.result.current.move.mutateAsync({ base: a, intent }).catch(() => null));
    // Query giữ structural sharing ⇒ so sánh giá trị, không so tham chiếu.
    expect(board().byId[a.id]).toEqual(a);
    expect(toastTitles()).toContain(title);
  });

  it('404 ⇒ xóa task khỏi board', async () => {
    vi.spyOn(taskApi, 'move').mockRejectedValue(
      apiError(404, 'RESOURCE_NOT_FOUND', { resource: 'task' }),
    );
    const { hook, board } = setup([a, b]);
    await act(() => hook.result.current.move.mutateAsync({ base: a, intent }).catch(() => null));
    expect(board().byId[a.id]).toBeUndefined();
  });

  it('rollback KHÔNG xóa thay đổi mới hơn đến qua socket giữa chừng', async () => {
    let reject!: (e: unknown) => void;
    vi.spyOn(taskApi, 'move').mockImplementation(() => new Promise((_, r) => (reject = r)));
    const { hook, board, client } = setup([a, b]);
    act(() => hook.result.current.move.mutate({ base: a, intent }));
    await waitFor(() => expect(board().byId[a.id]?.status).toBe('IN_PROGRESS'));
    const theirs = { ...a, title: 'socket', version: 5 };
    act(() => {
      client.setQueryData(boardKey, (old: BoardData) => ({
        byId: { ...old.byId, [a.id]: theirs },
      }));
    });
    await act(async () => {
      reject(apiError(500, 'INTERNAL_ERROR'));
      await Promise.resolve();
    });
    await waitFor(() => expect(hook.result.current.move.isError).toBe(true));
    expect(board().byId[a.id]).toEqual(theirs);
  });

  it('task khác trên board giữ nguyên tham chiếu suốt quá trình', async () => {
    vi.spyOn(taskApi, 'move').mockResolvedValue({ ...a, status: 'IN_PROGRESS', version: 2 });
    const { hook, board } = setup([a, b]);
    await act(() => hook.result.current.move.mutateAsync({ base: a, intent }));
    expect(board().byId[b.id]).toBe(b);
  });
});

describe('optimisticTask — rank tạm', () => {
  it('hàng xóm lệch (after ≥ before) ⇒ đổi cột + đặt cuối cột', () => {
    const x = makeTask({ status: 'IN_PROGRESS', rank: 'a2' });
    const y = makeTask({ status: 'IN_PROGRESS', rank: 'a1' });
    const t = makeTask({ rank: 'a0' });
    const board = boardFromTasks([x, y, t]);
    const result = optimisticTask(board, {
      base: t,
      intent: { status: 'IN_PROGRESS', afterId: x.id, beforeId: y.id },
    });
    expect(result.status).toBe('IN_PROGRESS');
    expect(result.rank > 'a2').toBe(true);
    expect(result.version).toBe(t.version);
  });
});
