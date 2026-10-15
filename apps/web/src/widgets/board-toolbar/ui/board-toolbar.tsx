'use client';

import type { ProjectDto } from '@taskflow/contracts/project';
import Link from 'next/link';

import type { TaskScope } from '@/entities/task';
import { QuickCreateTask } from '@/features/task-create';
import { useRealtimeStatus } from '@/shared/socket';
import { Button } from '@/shared/ui/button';
import { ConnectionDot } from '@/shared/ui/connection-dot';

type Props = Readonly<{
  scope: TaskScope;
  project: ProjectDto;
  canCreate: boolean;
  /** Board mất realtime ⇒ cho tải lại thủ công (frontend.md §3.5). */
  onReload: () => void;
}>;

/** Đầu board: tên project, trạng thái kết nối, tạo nhanh task, banner lưu trữ (wireframe §1.4). */
export function BoardToolbar({ scope, project, canCreate, onReload }: Props) {
  const connection = useRealtimeStatus();
  return (
    <div className="flex flex-col gap-3">
      <nav aria-label="Vị trí" className="text-xs text-text-muted">
        <Link href={`/w/${scope.wsId}/projects`} className="hover:underline">
          Dự án
        </Link>
        <span aria-hidden="true"> › </span>
        <span>{project.name}</span>
        <span aria-hidden="true"> · </span>
        <Link href={`/w/${scope.wsId}/p/${project.id}/settings`} className="hover:underline">
          Cài đặt dự án
        </Link>
      </nav>
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <h1 className="text-xl font-semibold">
          {project.name}{' '}
          <span className="text-sm font-normal text-text-muted">· {project.keyPrefix}</span>
        </h1>
        <div className="flex items-center gap-2 pb-1">
          <ConnectionDot state={connection} />
          {connection === 'offline' && (
            <Button variant="ghost" size="sm" onClick={onReload}>
              Tải lại bảng
            </Button>
          )}
        </div>
        {canCreate && !project.isArchived && (
          <div className="ml-auto">
            <QuickCreateTask scope={scope} />
          </div>
        )}
      </div>
      {project.isArchived && (
        <p
          role="status"
          className="rounded-control border-l-4 border-warning bg-[color-mix(in_srgb,var(--warning)_10%,transparent)] px-3 py-2 text-sm"
        >
          Dự án đã lưu trữ — chỉ đọc.
        </p>
      )}
    </div>
  );
}
