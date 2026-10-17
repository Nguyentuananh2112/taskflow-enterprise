import type { WorkspaceRole } from '@taskflow/contracts/rbac';
import { UserDto } from '@taskflow/contracts/auth';
import type { TaskDto, TaskStatus } from '@taskflow/contracts/task';
import { act, render } from '@testing-library/react';
import { getResponse } from 'msw';
import { useSyncExternalStore } from 'react';

import { API_BASE, type startMockApi } from '@test/mock-api';
import { testRouter } from '@test/navigation';

import { AppShell } from '@/app/gates';
import { AppProviders } from '@/app/providers';
import { session } from '@/entities/session';
import type { RealtimeClient } from '@/shared/socket';
import { BoardPage } from '@/views/board';

import { FakeRealtimeHub } from './fake-realtime';

// Dựng board thật (AppProviders + AppShell + BoardPage) trên mock API + socket giả.
// Dùng: vi.mock('next/navigation', async () => (await import('@test/navigation')).nextNavigationMock)

export type BoardFixture = Awaited<ReturnType<typeof seedBoard>>;

/** Người dùng + workspace mặc định + project "Dự án đầu tiên" (ADR-103), đăng nhập sẵn. */
export function seedBoard(mock: ReturnType<typeof startMockApi>) {
  const owner = mock.db.createUser({
    email: 'lan@example.com',
    password: 'x',
    fullName: 'Trần Lan',
  });
  const wsId = owner.defaultWorkspaceId;
  const project = mock.board.listProjects(wsId, 'false')[0];
  if (!project) throw new Error('thiếu project mặc định');
  const membership = mock.db.membershipIn(owner.user.id, wsId);
  if (!membership) throw new Error('thiếu membership');
  const tokenOf = (user: typeof owner.user) => mock.db.issueAccess(user).accessToken;

  const addUser = (fullName: string, email: string, role: WorkspaceRole) => {
    const { user } = mock.db.createUser({ email, password: 'x', fullName });
    mock.db.setMembership(user.id, membership, role);
    return user;
  };

  /** Gọi API như một tab KHÁC (X-Client-Id khác) — event realtime sẽ tới các client đã join. */
  const apiAs = async (
    user: typeof owner.user,
    method: string,
    path: string,
    body?: unknown,
    clientId: string = crypto.randomUUID(),
  ) => {
    const response = await getResponse(
      mock.handlers,
      new Request(API_BASE + path, {
        method,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${tokenOf(user)}`,
          'x-client-id': clientId,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
    const json = (await response?.json()) as { data: TaskDto };
    return json.data;
  };

  const tasksPath = `/workspaces/${wsId}/projects/${project.id}/tasks`;
  const createTask = (title: string, by = owner.user) => apiAs(by, 'POST', tasksPath, { title });
  const moveTask = (task: TaskDto, status: TaskStatus, by = owner.user) =>
    apiAs(by, 'PATCH', `${tasksPath}/${task.id}/move`, { expectedVersion: task.version, status });

  /**
   * Mốc 3.5: quyền CẤP CÔNG TY (như Admin làm ở Quản trị › Phân quyền). Mặc định mọi user mock là nhân viên; `HR`
   * = EMPLOYEE + HR_MANAGE (vẫn chấm công), `ADMIN` = Admin (không chấm công / xin nghỉ — ADR-134).
   */
  const setCompanyAccess = (user: typeof owner.user, access: 'EMPLOYEE' | 'HR' | 'ADMIN') =>
    access === 'HR'
      ? mock.db.company.setAccess(user.id, 'EMPLOYEE', ['HR_MANAGE'])
      : mock.db.company.setAccess(user.id, access);

  /** Đăng nhập tab này bằng `user` (thay cho luồng /auth/refresh — đã test ở auth-flow). */
  const signInAs = (user: typeof owner.user) =>
    act(() => session.signIn(mock.db.issueAccess(user), UserDto.parse(user)));

  return {
    owner: owner.user,
    wsId,
    project,
    boardUrl: `/w/${wsId}/p/${project.id}`,
    tasksPath,
    addUser,
    apiAs,
    createTask,
    moveTask,
    setCompanyAccess,
    signInAs,
  };
}

const currentUrl = () => window.location.pathname + window.location.search;

function App({ client }: Readonly<{ client: RealtimeClient }>) {
  // Theo dõi cả query (`?task=`) — drawer mở/đóng theo URL.
  useSyncExternalStore(testRouter.subscribe, currentUrl);
  return (
    <AppProviders
      config={{ apiUrl: API_BASE, wsUrl: 'http://localhost:4000', appEnv: 'test' }}
      nonce={undefined}
      realtime={() => client}
    >
      <AppShell>
        <BoardPage />
      </AppShell>
    </AppProviders>
  );
}

/** Mở URL board trong một "tab" với socket giả `client`. */
export function openBoard(url: string, client: RealtimeClient) {
  window.history.replaceState({}, '', url);
  return render(<App client={client} />);
}

export { FakeRealtimeHub };
