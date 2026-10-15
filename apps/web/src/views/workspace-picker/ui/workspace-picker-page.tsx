'use client';

import { useMe } from '@/entities/session';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/empty-state';
import { Skeleton } from '@/shared/ui/skeleton';

const ROLE_LABEL = {
  OWNER: 'Chủ sở hữu',
  PM: 'Quản lý dự án',
  MEMBER: 'Thành viên',
  VIEWER: 'Người xem',
} as const;

/**
 * `/w` — dashboard sau đăng nhập (T-019: bản rút gọn, chỉ liệt kê workspace từ `/auth/me`).
 * Danh sách project / board là ticket sau.
 */
export function WorkspacePickerPage() {
  const me = useMe();
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8">
      <h1 className="text-xl font-semibold">Workspace của bạn</h1>
      {me.isPending && (
        <div role="status" aria-busy="true" aria-label="Đang tải workspace" className="grid gap-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      )}
      {me.isError && (
        <EmptyState
          title="Không tải được danh sách workspace"
          action={<Button onClick={() => void me.refetch()}>Thử lại</Button>}
        />
      )}
      {me.data?.memberships.length === 0 && (
        <EmptyState
          title="Bạn chưa thuộc workspace nào"
          description="Tạo workspace để bắt đầu (sắp có)."
        />
      )}
      {me.data && me.data.memberships.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {me.data.memberships.map((m) => (
            <li
              key={m.workspaceId}
              className="flex items-center justify-between gap-3 rounded-card border border-border bg-surface p-4 shadow-card"
            >
              <span className="font-medium">{m.workspaceName}</span>
              <Badge>{ROLE_LABEL[m.role]}</Badge>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
