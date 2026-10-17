'use client';

import { Uuid } from '@taskflow/contracts/common';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';

import { ProjectCard, useProjects, type ProjectListFilter } from '@/entities/project';
import { usePermission } from '@/entities/workspace';
import { isApiError } from '@/shared/api';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/empty-state';
import { Skeleton } from '@/shared/ui/skeleton';
import { PageMain } from '@/shared/ui/page';

import { ProjectListHeader } from './project-list-header';

const TABS: ReadonlyArray<{ value: ProjectListFilter; label: string }> = [
  { value: 'false', label: 'Đang hoạt động' },
  { value: 'true', label: 'Đã lưu trữ' },
];

/** `/w/[wsId]/projects` — danh sách project, tab Đang hoạt động / Đã lưu trữ (frontend.md §1.2). */
export function ProjectListPage() {
  const { wsId = '' } = useParams<{ wsId: string }>();
  const archived: ProjectListFilter =
    useSearchParams().get('archived') === 'true' ? 'true' : 'false';
  const valid = Uuid.safeParse(wsId).success;
  const projects = useProjects(wsId, archived, valid);
  const { can } = usePermission(wsId);
  const list = projects.data?.pages.flatMap((page) => page.data) ?? [];

  if (!valid || isApiError(projects.error, 'RESOURCE_NOT_FOUND')) {
    return (
      <main className="mx-auto max-w-md px-4 py-16">
        <EmptyState title="Không tìm thấy hoặc bạn không có quyền truy cập" />
      </main>
    );
  }
  return (
    <PageMain className="gap-6">
      <ProjectListHeader wsId={wsId} canCreate={can('project:create')} />
      <nav aria-label="Lọc dự án" className="flex gap-2">
        {TABS.map((tab) => (
          <Link
            key={tab.value}
            href={
              tab.value === 'true' ? `/w/${wsId}/projects?archived=true` : `/w/${wsId}/projects`
            }
            aria-current={tab.value === archived ? 'page' : undefined}
            className={cn(
              'rounded-control px-3 py-1.5 text-sm',
              tab.value === archived ? 'bg-primary text-primary-fg' : 'hover:bg-bg-subtle',
            )}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      {projects.isPending && (
        <div
          role="status"
          aria-busy="true"
          aria-label="Đang tải dự án"
          className="grid gap-3 sm:grid-cols-2"
        >
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      )}
      {projects.isError && (
        <EmptyState
          title="Không tải được danh sách dự án"
          action={<Button onClick={() => void projects.refetch()}>Thử lại</Button>}
        />
      )}
      {projects.isSuccess && list.length === 0 && (
        <EmptyState
          title={archived === 'true' ? 'Không có dự án đã lưu trữ' : 'Chưa có dự án nào'}
          {...(can('project:create') && archived === 'false'
            ? { description: 'Bấm "Tạo dự án" để bắt đầu.' }
            : {})}
        />
      )}
      {list.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {list.map((project) => (
            <li key={project.id}>
              <ProjectCard project={project} />
            </li>
          ))}
        </ul>
      )}
      {projects.hasNextPage && (
        <Button
          variant="secondary"
          className="self-center"
          loading={projects.isFetchingNextPage}
          onClick={() => void projects.fetchNextPage()}
        >
          Tải thêm
        </Button>
      )}
    </PageMain>
  );
}
