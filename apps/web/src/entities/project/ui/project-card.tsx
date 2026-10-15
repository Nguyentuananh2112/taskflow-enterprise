import type { ProjectDto } from '@taskflow/contracts/project';
import Link from 'next/link';

import { Badge } from '@/shared/ui/badge';

/** Thẻ project trong danh sách — cả thẻ là link tới board (uuid trong URL — frontend.md §1.1). */
export function ProjectCard({ project }: Readonly<{ project: ProjectDto }>) {
  return (
    <Link
      href={`/w/${project.workspaceId}/p/${project.id}`}
      className="flex h-full flex-col gap-2 rounded-card border border-border bg-surface p-4 shadow-card hover:border-primary"
    >
      <span className="flex items-center gap-2">
        <span className="font-semibold text-text">{project.name}</span>
        <span className="text-xs text-text-muted">{project.keyPrefix}</span>
        {project.isArchived && (
          <Badge tone="warning" className="ml-auto">
            Đã lưu trữ
          </Badge>
        )}
      </span>
      {project.description && (
        <span className="line-clamp-2 text-sm text-text-muted">{project.description}</span>
      )}
    </Link>
  );
}
