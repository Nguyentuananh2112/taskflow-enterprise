import { render } from '@testing-library/react';
import { useSyncExternalStore, type ReactNode } from 'react';

import { API_BASE } from '@test/mock-api';
import { testRouter } from '@test/navigation';

import { AppShell } from '@/app/gates';
import { AppProviders } from '@/app/providers';
import type { RealtimeClient } from '@/shared/socket';
import { BoardPage } from '@/views/board';
import { MembersPage } from '@/views/members';
import { ProjectListPage } from '@/views/project-list';
import { ProjectSettingsPage } from '@/views/project-settings';
import { WorkspaceNewPage } from '@/views/workspace-new';
import { WorkspacePickerPage } from '@/views/workspace-picker';
import { WorkspaceSettingsPage } from '@/views/workspace-settings';

// Cây app thật cho mọi route `(app)` (giống app/(app)/…): AppProviders + AppShell + view theo URL.
// Dùng: vi.mock('next/navigation', async () => (await import('@test/navigation')).nextNavigationMock)

const ROUTES: ReadonlyArray<readonly [RegExp, () => ReactNode]> = [
  [/^\/w$/, () => <WorkspacePickerPage />],
  [/^\/w\/new$/, () => <WorkspaceNewPage />],
  [/^\/w\/[^/]+\/projects$/, () => <ProjectListPage />],
  [/^\/w\/[^/]+\/settings$/, () => <WorkspaceSettingsPage />],
  [/^\/w\/[^/]+\/settings\/members$/, () => <MembersPage />],
  [/^\/w\/[^/]+\/p\/[^/]+\/settings$/, () => <ProjectSettingsPage />],
  [/^\/w\/[^/]+\/p\/[^/]+$/, () => <BoardPage />],
];

const currentUrl = () => window.location.pathname + window.location.search;

function App({ client }: Readonly<{ client: RealtimeClient }>) {
  useSyncExternalStore(testRouter.subscribe, currentUrl);
  const view = ROUTES.find(([pattern]) => pattern.test(window.location.pathname))?.[1];
  return (
    <AppProviders
      config={{ apiUrl: API_BASE, wsUrl: 'http://localhost:4000', appEnv: 'test' }}
      nonce={undefined}
      realtime={() => client}
    >
      <AppShell>{view ? view() : <p>404 {window.location.pathname}</p>}</AppShell>
    </AppProviders>
  );
}

/** Mở URL như gõ vào thanh địa chỉ, với socket giả `client`. */
export function openApp(url: string, client: RealtimeClient) {
  window.history.replaceState({}, '', url);
  return render(<App client={client} />);
}
