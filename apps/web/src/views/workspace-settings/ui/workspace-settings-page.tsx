'use client';

import { Uuid } from '@taskflow/contracts/common';
import { useParams, useRouter } from 'next/navigation';

import { usePermission, useWorkspace } from '@/entities/workspace';
import { DeleteWorkspaceSection } from '@/features/workspace-delete';
import { WorkspaceGeneralForm } from '@/features/workspace-edit';
import { isApiError } from '@/shared/api';
import { Button } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/empty-state';
import { Skeleton } from '@/shared/ui/skeleton';
import { SettingsTabs } from '@/widgets/settings-tabs';

/** `/w/[wsId]/settings` — tên/slug (OWNER sửa, người khác xem), vùng nguy hiểm (OWNER). */
export function WorkspaceSettingsPage() {
  const { wsId = '' } = useParams<{ wsId: string }>();
  const router = useRouter();
  const valid = Uuid.safeParse(wsId).success;
  const workspace = useWorkspace(wsId);
  const { can } = usePermission(wsId);

  if (!valid || isApiError(workspace.error, 'RESOURCE_NOT_FOUND')) {
    return (
      <main className="mx-auto max-w-md px-4 py-16">
        <EmptyState title="Không tìm thấy hoặc bạn không có quyền truy cập" />
      </main>
    );
  }
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
      <h1 className="text-xl font-semibold">Cài đặt workspace</h1>
      <SettingsTabs wsId={wsId} current="general" />
      {workspace.isPending && (
        <div role="status" aria-busy="true" aria-label="Đang tải workspace" className="grid gap-3">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      )}
      {workspace.isError && !isApiError(workspace.error, 'RESOURCE_NOT_FOUND') && (
        <EmptyState
          title="Không tải được workspace"
          action={<Button onClick={() => void workspace.refetch()}>Thử lại</Button>}
        />
      )}
      {workspace.data && (
        <>
          <WorkspaceGeneralForm
            key={`${workspace.data.id}:${workspace.data.updatedAt}`}
            workspace={workspace.data}
            canEdit={can('workspace:update')}
          />
          {can('workspace:delete') && (
            <DeleteWorkspaceSection
              workspace={workspace.data}
              onDeleted={() => router.replace('/w')}
            />
          )}
        </>
      )}
    </main>
  );
}
