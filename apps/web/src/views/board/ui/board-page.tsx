'use client';

import type { TaskDeletedEvent } from '@taskflow/contracts/realtime';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useCallback } from 'react';

import { useProject } from '@/entities/project';
import { taskKeys, useBoard } from '@/entities/task';
import { usePermission, useWorkspace } from '@/entities/workspace';
import { useBoardRealtime } from '@/features/board-realtime';
import { isApiError } from '@/shared/api';
import { Button } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/empty-state';
import { toast } from '@/shared/ui/toast';
import { PageMain } from '@/shared/ui/page';
import { BoardToolbar } from '@/widgets/board-toolbar';
import { KanbanBoard } from '@/widgets/kanban-board';
import { TaskDetailDrawer } from '@/widgets/task-detail-drawer';

import { useBoardRoute } from '../model/use-board-route';
import { BoardSkeleton } from './board-skeleton';

type Route = ReturnType<typeof useBoardRoute>;

/** API trả 404 cho cả "không tồn tại" và "không có quyền" (ADR-020) ⇒ một màn chung (§1.1). */
const NOT_FOUND = (
  <main className="mx-auto max-w-md px-4 py-16">
    <EmptyState
      title="Không tìm thấy hoặc bạn không có quyền truy cập"
      action={
        <Button asChild>
          <Link href="/w">Về danh sách workspace</Link>
        </Button>
      }
    />
  </main>
);

/** `/w/[wsId]/p/[projectId]` (+ `?task=`) — board Kanban (frontend.md §1, §4). */
export function BoardPage() {
  const route = useBoardRoute();
  return route.valid ? <BoardScreen route={route} /> : NOT_FOUND;
}

function BoardScreen({ route }: Readonly<{ route: Route }>) {
  const { scope, taskId, openTask, closeTask, returnFocus } = route;
  const queryClient = useQueryClient();
  const workspace = useWorkspace(scope.wsId);
  const permission = usePermission(scope.wsId);
  const project = useProject(scope.wsId, scope.projectId);
  const board = useBoard(scope);
  const onOpenTaskDeleted = useCallback(
    (event: TaskDeletedEvent) => {
      toast({ title: `${event.data.key} vừa bị người khác xóa` });
      closeTask();
    },
    [closeTask],
  );
  const realtime = useBoardRealtime(scope, { openTaskId: taskId, onOpenTaskDeleted });
  const reload = useCallback(
    () =>
      void queryClient.invalidateQueries({ queryKey: taskKeys.board(scope.wsId, scope.projectId) }),
    [queryClient, scope.wsId, scope.projectId],
  );

  const errors = [workspace.error, project.error, board.error];
  if (realtime.notFound || errors.some((e) => isApiError(e, 'RESOURCE_NOT_FOUND')))
    return NOT_FOUND;
  if (project.isError || board.isError) {
    return (
      <main className="mx-auto max-w-md px-4 py-16">
        <EmptyState
          title="Không tải được bảng"
          action={
            <Button onClick={() => void Promise.all([project.refetch(), board.refetch()])}>
              Thử lại
            </Button>
          }
        />
      </main>
    );
  }

  const archived = project.data?.isArchived ?? false;
  const empty = board.data && Object.keys(board.data.byId).length === 0;
  return (
    <PageMain className="gap-4">
      {project.data ? (
        <BoardToolbar
          scope={scope}
          project={project.data}
          canCreate={permission.can('task:create')}
          onReload={reload}
        />
      ) : (
        <h1 className="sr-only">Bảng công việc</h1>
      )}
      {!board.data || !project.data ? (
        <BoardSkeleton />
      ) : (
        <>
          {empty && (
            <p className="text-sm text-text-muted">
              Chưa có task.{' '}
              {permission.can('task:create') &&
                !archived &&
                'Dùng ô "Task mới" để tạo task đầu tiên.'}
            </p>
          )}
          <KanbanBoard
            scope={scope}
            board={board.data}
            canDrag={permission.can('task:move') && !archived}
            onOpen={openTask}
          />
        </>
      )}
      <TaskDetailDrawer
        scope={scope}
        taskId={taskId}
        permission={permission}
        archived={archived}
        onClose={closeTask}
        onCloseAutoFocus={returnFocus}
      />
    </PageMain>
  );
}
