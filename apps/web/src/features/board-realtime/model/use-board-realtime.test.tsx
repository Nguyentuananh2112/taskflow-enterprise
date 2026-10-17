import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FakeRealtimeHub, type FakeRealtimeClient } from '@test/fake-realtime';

import { boardQuery, taskApi, useBoard } from '@/entities/task';
import { createQueryClient } from '@/shared/query';
import { RealtimeClientProvider } from '@/shared/socket';

import { JOIN_SNAPSHOT_GAP_MS, useBoardRealtime } from './use-board-realtime';

// T-044 S3 (review E): board được prefetch từ lúc có token, còn join phòng chỉ xảy ra sau /auth/me + tải socket +
// handshake ⇒ event trong khe "snapshot → join" phải được bù bằng MỘT lần refetch sau lần join đầu.

const scope = {
  wsId: '0199e5a2-0000-7000-8000-0000000000a1',
  projectId: '0199e5a2-0000-7000-8000-0000000000b1',
};
const options = { openTaskId: null, onOpenTaskDeleted: () => undefined };

function setup() {
  const queryClient = createQueryClient();
  const client: FakeRealtimeClient = new FakeRealtimeHub().client();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <RealtimeClientProvider client={client}>{children}</RealtimeClientProvider>
    </QueryClientProvider>
  );
  const mount = () =>
    renderHook(
      () => {
        useBoard(scope);
        return useBoardRealtime(scope, options);
      },
      { wrapper },
    );
  return { queryClient, client, mount };
}

let now = 0;
afterEach(() => vi.restoreAllMocks());

function clock() {
  vi.spyOn(Date, 'now').mockImplementation(() => now);
}

describe('useBoardRealtime — khe snapshot → join (T-044 S3)', () => {
  it(`snapshot đã về, gửi trước lúc join > ${JOIN_SNAPSHOT_GAP_MS} ms ⇒ refetch board MỘT lần sau join đầu`, async () => {
    clock();
    const listAll = vi.spyOn(taskApi, 'listAll').mockResolvedValue([]);
    const t = setup();
    now = 1_000;
    await t.queryClient.prefetchQuery(boardQuery(scope)); // prefetch lúc có token
    t.mount();
    now = 2_000;
    act(() => t.client.connect()); // join sau /auth/me + socket
    await waitFor(() => expect(listAll).toHaveBeenCalledTimes(2));
    // Join lại sau reconnect KHÔNG thêm lần refetch "khe" (onReconnect đã invalidate riêng).
    act(() => t.client.drop());
    act(() => t.client.connect());
    await waitFor(() => expect(listAll).toHaveBeenCalledTimes(3));
  });

  it(`snapshot gửi trước lúc join ≤ ${JOIN_SNAPSHOT_GAP_MS} ms (điều hướng trong app) ⇒ KHÔNG tải lại`, async () => {
    clock();
    const listAll = vi.spyOn(taskApi, 'listAll').mockResolvedValue([]);
    const t = setup();
    now = 1_000;
    await t.queryClient.prefetchQuery(boardQuery(scope));
    t.mount();
    now = 1_000 + JOIN_SNAPSHOT_GAP_MS;
    act(() => t.client.connect());
    await act(() => Promise.resolve());
    expect(listAll).toHaveBeenCalledTimes(1);
  });

  it('snapshot còn ĐANG BAY lúc join ⇒ không hủy nó; về rồi mới refetch một lần', async () => {
    clock();
    let finish!: () => void;
    const listAll = vi
      .spyOn(taskApi, 'listAll')
      .mockImplementationOnce(() => new Promise((resolve) => (finish = () => resolve([]))))
      .mockResolvedValue([]);
    const t = setup();
    now = 1_000;
    void t.queryClient.prefetchQuery(boardQuery(scope));
    t.mount();
    now = 2_000;
    act(() => t.client.connect());
    await act(() => Promise.resolve());
    expect(listAll).toHaveBeenCalledTimes(1); // request đầu không bị hủy / gửi lại
    act(() => finish());
    await waitFor(() => expect(listAll).toHaveBeenCalledTimes(2));
  });
});
