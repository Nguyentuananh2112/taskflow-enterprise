'use client';

import { useRouter } from 'next/navigation';

import { CreateWorkspaceForm } from '@/features/workspace-create';

/** `/w/new` — tạo workspace (người tạo là Chủ sở hữu) rồi vào danh sách dự án. */
export function WorkspaceNewPage() {
  const router = useRouter();
  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-8">
      <h1 className="text-xl font-semibold">Tạo workspace</h1>
      <CreateWorkspaceForm onCreated={(ws) => router.push(`/w/${ws.id}/projects`)} />
    </main>
  );
}
