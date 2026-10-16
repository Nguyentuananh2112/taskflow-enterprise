'use client';

import { useRouter } from 'next/navigation';

import { CreateWorkspaceForm } from '@/features/workspace-create';
import { PageMain } from '@/shared/ui/page';

/** `/w/new` — tạo workspace (người tạo là Chủ sở hữu) rồi vào danh sách dự án. */
export function WorkspaceNewPage() {
  const router = useRouter();
  return (
    <PageMain className="max-w-md gap-6">
      <h1 className="text-xl font-semibold">Tạo workspace</h1>
      <CreateWorkspaceForm onCreated={(ws) => router.push(`/w/${ws.id}/projects`)} />
    </PageMain>
  );
}
