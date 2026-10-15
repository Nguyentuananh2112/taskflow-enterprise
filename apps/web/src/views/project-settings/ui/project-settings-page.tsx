'use client';

import { Uuid } from '@taskflow/contracts/common';
import Link from 'next/link';
import { useParams } from 'next/navigation';

import { useProject } from '@/entities/project';
import { usePermission } from '@/entities/workspace';
import { ArchiveProjectButton } from '@/features/project-archive';
import { ProjectGeneralForm } from '@/features/project-edit';
import { isApiError } from '@/shared/api';
import { Button } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/empty-state';
import { Skeleton } from '@/shared/ui/skeleton';

/** `/w/[wsId]/p/[projectId]/settings` — PM+ sửa/lưu trữ; VIEWER/MEMBER xem chỉ đọc (frontend.md §1.1). */
export function ProjectSettingsPage() {
  const { wsId = '', projectId = '' } = useParams<{ wsId: string; projectId: string }>();
  const valid = Uuid.safeParse(wsId).success && Uuid.safeParse(projectId).success;
  const project = useProject(wsId, projectId);
  const { can } = usePermission(wsId);

  if (!valid || isApiError(project.error, 'RESOURCE_NOT_FOUND')) {
    return (
      <main className="mx-auto max-w-md px-4 py-16">
        <EmptyState title="Không tìm thấy hoặc bạn không có quyền truy cập" />
      </main>
    );
  }
  const data = project.data;
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
      <nav aria-label="Vị trí" className="text-xs text-text-muted">
        <Link href={`/w/${wsId}/projects`} className="hover:underline">
          Dự án
        </Link>
        <span aria-hidden="true"> › </span>
        <Link href={`/w/${wsId}/p/${projectId}`} className="hover:underline">
          {data?.name ?? 'Bảng'}
        </Link>
      </nav>
      <h1 className="text-xl font-semibold">Cài đặt dự án</h1>
      {project.isPending && (
        <div role="status" aria-busy="true" aria-label="Đang tải dự án" className="grid gap-3">
          <Skeleton className="h-10" />
          <Skeleton className="h-24" />
        </div>
      )}
      {project.isError && !data && (
        <EmptyState
          title="Không tải được dự án"
          action={<Button onClick={() => void project.refetch()}>Thử lại</Button>}
        />
      )}
      {data?.isArchived && (
        <p role="status" className="rounded-control border-l-4 border-warning px-3 py-2 text-sm">
          Dự án đã lưu trữ — chỉ đọc. Khôi phục để sửa.
        </p>
      )}
      {data && (
        <>
          <ProjectGeneralForm
            key={`${data.id}:${data.updatedAt}`}
            project={data}
            canEdit={can('project:update')}
          />
          {can('project:archive') && (
            <div className="border-t border-border pt-4">
              <ArchiveProjectButton project={data} />
            </div>
          )}
        </>
      )}
    </main>
  );
}
