'use client';

import { Uuid } from '@taskflow/contracts/common';
import { useParams, useRouter } from 'next/navigation';

import { usePermission, useWorkspace } from '@/entities/workspace';
import { AddMemberForm } from '@/features/member-add';
import { isApiError } from '@/shared/api';
import { EmptyState } from '@/shared/ui/empty-state';
import { MemberTable } from '@/widgets/member-table';
import { SettingsTabs } from '@/widgets/settings-tabs';

/**
 * `/w/[wsId]/settings/members` (wireframe §1.6). Mọi role xem; PM+ thêm; OWNER đổi role.
 * Mất quyền khi đang mở (bị xóa / workspace bị xóa) ⇒ realtime-session đưa về /w + toast.
 */
export function MembersPage() {
  const { wsId = '' } = useParams<{ wsId: string }>();
  const router = useRouter();
  const valid = Uuid.safeParse(wsId).success;
  const workspace = useWorkspace(wsId);
  const permission = usePermission(wsId);

  if (!valid || isApiError(workspace.error, 'RESOURCE_NOT_FOUND')) {
    return (
      <main className="mx-auto max-w-md px-4 py-16">
        <EmptyState title="Không tìm thấy hoặc bạn không có quyền truy cập" />
      </main>
    );
  }
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8">
      <h1 className="text-xl font-semibold">
        Thành viên{workspace.data ? ` · ${workspace.data.name}` : ''}
      </h1>
      <SettingsTabs wsId={wsId} current="members" />
      {permission.can('member:add') && (
        <section aria-labelledby="add-member" className="flex flex-col gap-2">
          <h2 id="add-member" className="text-base font-semibold">
            Thêm thành viên
          </h2>
          <AddMemberForm wsId={wsId} actorRole={permission.role} />
        </section>
      )}
      <MemberTable wsId={wsId} permission={permission} onLeft={() => router.replace('/w')} />
    </main>
  );
}
