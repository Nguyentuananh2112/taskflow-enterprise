import type { QueryClient } from '@tanstack/react-query';

import { unreadCountQuery } from '@/entities/notification';
import { projectQuery } from '@/entities/project';
import { session } from '@/entities/session';
import { boardQuery } from '@/entities/task';
import { workspaceQuery, workspacesQuery } from '@/entities/workspace';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const WS_ROUTE = new RegExp(`^/w/(${UUID})(?:/p/(${UUID})(/[^?#]*)?)?(?:/|$)`, 'i');

/**
 * T-044 S3: query mà route sẽ cần NGAY khi hiện — gửi song song với /auth/me thay vì đợi `authenticated` rồi route
 * mới render và tự gửi. Chỉ những query chắc chắn được dùng ở route đó (không đoán quyền: `attendance/me/today` cần
 * role nên KHÔNG prefetch — VIEWER sẽ nhận 403). Cùng `queryOptions` với hook ⇒ cùng key, hook nhận cache sẵn.
 */
export function prefetchRouteQueries(client: QueryClient, pathname: string): void {
  void client.prefetchQuery(unreadCountQuery()); // chuông ở header của mọi route đã đăng nhập
  if (pathname === '/w' || pathname === '/w/') {
    void client.prefetchQuery(workspacesQuery());
    return;
  }
  const match = WS_ROUTE.exec(pathname);
  if (!match) return;
  const [, wsId, projectId, rest] = match as unknown as [string, string, string?, string?];
  void client.prefetchQuery(workspaceQuery(wsId)); // header (quyền) + trang
  if (!projectId) return;
  void client.prefetchQuery(projectQuery(wsId, projectId));
  if (!rest || rest === '/') void client.prefetchQuery(boardQuery({ wsId, projectId }));
}

const registered = new WeakSet<QueryClient>();

/** Gắn prefetch vào lúc khôi phục phiên có token (một lần cho mỗi QueryClient). Chỉ ở trình duyệt. */
export function registerRoutePrefetch(client: QueryClient): void {
  if (registered.has(client)) return;
  registered.add(client);
  session.onTokenRestored(() => prefetchRouteQueries(client, window.location.pathname));
}
