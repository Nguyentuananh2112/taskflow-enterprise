'use client';

import { useAdminWorkspaces } from '@/entities/company';
import { useCompanyPermission } from '@/entities/session';
import { WorkspaceActions } from '@/features/admin-workspace';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/empty-state';

import { AdminFrame, Loading } from './admin-frame';

/** `/admin/workspaces` (ADR-134): tên, chủ sở hữu, số thành viên, cờ — KHÔNG nội dung dự án. Mồ côi lên đầu. */
export function AdminWorkspacesPage() {
  const allowed = useCompanyPermission().can('company:admin');
  const list = useAdminWorkspaces(allowed);
  return (
    <AdminFrame title="Workspace">
      {list.isPending ? (
        <Loading label="Đang tải workspace" />
      ) : list.isError ? (
        <EmptyState
          title="Không tải được danh sách workspace"
          action={<Button onClick={() => void list.refetch()}>Thử lại</Button>}
        />
      ) : list.data.length === 0 ? (
        <EmptyState title="Chưa có workspace nào" />
      ) : (
        <ul aria-label="Danh sách workspace" className="flex flex-col gap-2">
          {list.data.map((ws) => (
            <li
              key={ws.id}
              aria-label={ws.name}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border border-border bg-surface p-4"
            >
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  {ws.name}
                  {ws.orphan && !ws.deletedAt && !ws.archivedAt && (
                    <Badge tone="danger">Mồ côi</Badge>
                  )}
                  {ws.deletedAt && <Badge>Đã xóa</Badge>}
                  {ws.archivedAt && <Badge>Đã lưu trữ</Badge>}
                </p>
                <p className="text-sm text-text-muted">
                  {ws.owners.length > 0
                    ? `Chủ sở hữu: ${ws.owners.map((o) => o.fullName).join(', ')}`
                    : 'Không còn chủ sở hữu'}{' '}
                  · {ws.memberCount} thành viên
                </p>
              </div>
              <WorkspaceActions workspace={ws} />
            </li>
          ))}
        </ul>
      )}
    </AdminFrame>
  );
}
