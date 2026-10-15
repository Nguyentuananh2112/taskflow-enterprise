'use client';

import Link from 'next/link';

import { useMe } from '@/entities/session';
import { ROLE_LABEL } from '@/entities/workspace';
import { DeletedWorkspaces } from '@/features/workspace-restore';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/empty-state';
import { Skeleton } from '@/shared/ui/skeleton';

/**
 * `/w` — workspace của tôi (từ `/auth/me`) dẫn tới danh sách project (T-025); nút Tạo workspace và khu
 * "Đã xóa — khôi phục được" cho OWNER (T-034, ADR-050).
 */
export function WorkspacePickerPage() {
  const me = useMe();
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Workspace của bạn</h1>
        <Button asChild variant="secondary" className="ml-auto">
          <Link href="/w/new">Tạo workspace</Link>
        </Button>
      </div>
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
        <EmptyState title="Bạn chưa thuộc workspace nào" description="Tạo workspace để bắt đầu." />
      )}
      {me.data && me.data.memberships.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {me.data.memberships.map((m) => (
            <li key={m.workspaceId}>
              <Link
                href={`/w/${m.workspaceId}/projects`}
                className="flex items-center justify-between gap-3 rounded-card border border-border bg-surface p-4 shadow-card hover:border-primary"
              >
                <span className="font-medium">{m.workspaceName}</span>
                <Badge>{ROLE_LABEL[m.role]}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <DeletedWorkspaces />
    </main>
  );
}
