import { LoginResponse, MeResponse } from '@taskflow/contracts/auth';
import { apiSuccess } from '@taskflow/contracts/common';
import { TaskDto } from '@taskflow/contracts/task';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSyncExternalStore } from 'react';
import { afterAll, expect, it, vi } from 'vitest';

import { testRouter } from '@test/navigation';

import { AppShell } from '@/app/gates';
import { AppProviders } from '@/app/providers';
import { session } from '@/entities/session';
import { getClientId } from '@/shared/lib/client-id';
import { loadSocketIoClient, type RealtimeClient } from '@/shared/socket';
import { BoardPage } from '@/views/board';

import { API, ORIGIN, PASSWORD, api } from './real-api-client';

vi.mock('next/navigation', async () => (await import('@test/navigation')).nextNavigationMock);

// T-025 — lượt chạy với API THẬT: hai "tab" (2 cây app, 2 QueryClient, 2 kết nối Socket.io thật với
// clientId khác nhau). A chuyển thẻ qua menu (cùng đường useMoveTask với kéo thả) ⇒ server ghi DB,
// phát `task:moved` qua Socket.io ⇒ B thấy thẻ đổi cột; B tạo task (X-Client-Id của B) ⇒ A thấy.

const WS = new URL(API).origin;
const EMAIL = process.env.REAL_API_EMAIL ?? 'real1@example.com';

const currentUrl = () => window.location.pathname + window.location.search;

function Tab({ client }: Readonly<{ client: () => RealtimeClient }>) {
  useSyncExternalStore(testRouter.subscribe, currentUrl);
  return (
    <AppProviders
      config={{ apiUrl: API, wsUrl: WS, appEnv: 'local' }}
      nonce={undefined}
      realtime={client}
    >
      <AppShell>
        <BoardPage />
      </AppShell>
    </AppProviders>
  );
}

afterAll(() => {
  cleanup();
  session.resetForTest();
});

it.skipIf(!PASSWORD)(
  'API thật: A chuyển thẻ ⇒ B thấy qua Socket.io; B tạo task ⇒ A thấy',
  async () => {
    const login = await api(
      '/auth/login',
      { method: 'POST', body: { email: EMAIL, password: PASSWORD } },
      (j) => apiSuccess(LoginResponse).parse(j).data,
    );
    const token = login.accessToken;
    const me = await api('/auth/me', { token }, (j) => apiSuccess(MeResponse).parse(j).data);
    const wsId = me.memberships[0]?.workspaceId ?? '';
    const projects = await api(
      `/workspaces/${wsId}/projects`,
      { token },
      (j) => (j as { data: Array<{ id: string }> }).data,
    );
    const projectId = projects[0]?.id ?? '';
    const tasksPath = `/workspaces/${wsId}/projects/${projectId}/tasks`;
    const title = `Kiểm thử realtime ${Date.now()}`;
    const task = await api(
      tasksPath,
      { method: 'POST', body: { title }, token },
      (j) => apiSuccess(TaskDto).parse(j).data,
    );

    act(() => session.signIn({ accessToken: token, expiresIn: login.expiresIn }, login.user));
    window.history.replaceState({}, '', `/w/${wsId}/p/${projectId}`);
    const realtimeAuth = session.realtimeAuth;
    // Node (`ws`) không tự gửi Origin như trình duyệt ⇒ đặt tay; server vẫn kiểm whitelist như thật.
    const extraHeaders = { origin: ORIGIN };
    const createSocketIoClient = await loadSocketIoClient();
    const clientA = createSocketIoClient({
      url: WS,
      clientId: getClientId(),
      auth: realtimeAuth,
      extraHeaders,
    });
    const clientB = createSocketIoClient({
      url: WS,
      clientId: crypto.randomUUID(),
      auth: realtimeAuth,
      extraHeaders,
    });
    const tabA = render(<Tab client={() => clientA} />).container;
    const tabB = render(<Tab client={() => clientB} />).container;

    const columnOf = (tab: HTMLElement, name: RegExp) => within(tab).getByRole('region', { name });
    await within(tabA).findByRole('article', { name: title }, { timeout: 15_000 });
    await within(tabB).findByRole('article', { name: title }, { timeout: 15_000 });
    // Cả hai socket thật đã kết nối (handshake token + Origin) trước khi thao tác.
    await waitFor(
      () => expect([clientA.status(), clientB.status()]).toEqual(['connected', 'connected']),
      {
        timeout: 15_000,
      },
    );
    await new Promise((r) => setTimeout(r, 500)); // để project:join của hai tab được ack

    const user = userEvent.setup();
    await user.click(within(tabA).getByRole('button', { name: `Thao tác với ${task.key}` }));
    await user.click(await screen.findByRole('menuitem', { name: 'Chuyển tới Đang làm' }));

    await waitFor(
      () =>
        expect(
          within(columnOf(tabB, /Đang làm/)).queryByRole('article', { name: title }),
        ).toBeTruthy(),
      { timeout: 10_000 },
    );
    const saved = await api(
      `${tasksPath}/${task.id}`,
      { token },
      (j) => apiSuccess(TaskDto).parse(j).data,
    );
    expect(saved).toMatchObject({ status: 'IN_PROGRESS', version: task.version + 1 });

    const fromB = `Task do tab B tạo ${Date.now()}`;
    await api(
      tasksPath,
      { method: 'POST', body: { title: fromB }, token, clientId: clientB.clientId },
      (j) => apiSuccess(TaskDto).parse(j).data,
    );
    await waitFor(
      () =>
        expect(
          within(columnOf(tabA, /Cần làm/)).queryByRole('article', { name: fromB }),
        ).toBeTruthy(),
      { timeout: 10_000 },
    );

    clientA.disconnect();
    clientB.disconnect();
  },
);
