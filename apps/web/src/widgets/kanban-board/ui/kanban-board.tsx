'use client';

import { DragDropProvider, DragOverlay } from '@dnd-kit/react';
import { TASK_STATUS_ORDER, type TaskDto } from '@taskflow/contracts/task';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import {
  TaskCard,
  allowedTargets,
  emptyColumns,
  toColumns,
  type BoardColumns,
  type BoardData,
  type TaskScope,
} from '@/entities/task';
import {
  toColumnIds,
  useMoveTask,
  usePendingMoveIds,
  type ColumnIds,
  type MoveIntent,
} from '@/features/task-move';
import { useCspNonce } from '@/shared/config';

import { createBoardPlugins } from '../model/a11y-announcements';
import { BOARD_SENSORS } from '../model/card-drag-sensors';
import { useBoardDnd } from '../model/use-board-dnd';
import { useReducedMotion } from '../model/use-reduced-motion';
import { BoardColumn } from './board-column';

type Props = Readonly<{
  scope: TaskScope;
  board: BoardData;
  /** `task:move` && project chưa lưu trữ (frontend.md §4.2 "Ai được kéo"). */
  canDrag: boolean;
  onOpen: (taskId: string) => void;
}>;

/** Cột hiển thị trong lúc kéo: từ preview cục bộ (task vừa bị xóa qua socket thì bỏ qua). */
function fromPreview(preview: ColumnIds, byId: BoardData['byId']): BoardColumns {
  const columns = emptyColumns();
  for (const status of TASK_STATUS_ORDER) {
    for (const id of preview[status]) {
      const task = byId[id];
      if (task) columns[status].push(task);
    }
  }
  return columns;
}

const noop = () => undefined;

/** Board 4 cột kéo thả (@dnd-kit/react) — DragDropProvider, cột, overlay (frontend.md §4.1). */
export function KanbanBoard({ scope, board, canDrag, onOpen }: Props) {
  const { mutate: move } = useMoveTask(scope);
  const onMove = useCallback(
    (task: TaskDto, intent: MoveIntent) => move({ base: task, intent }),
    [move],
  );
  const nonce = useCspNonce();
  // Ổn định theo nonce: provider không dựng lại manager mỗi lần render.
  const plugins = useMemo(() => createBoardPlugins(nonce), [nonce]);
  const columns = useMemo(() => toColumns(board), [board]);
  const { state, handlers } = useBoardDnd({ columns, byId: board.byId, onMove });
  const view = useMemo(
    () => (state.preview ? fromPreview(state.preview, board.byId) : columns),
    [state.preview, board.byId, columns],
  );
  const pendingIds = usePendingMoveIds();
  const reducedMotion = useReducedMotion();
  const latestColumns = useRef(columns);
  useEffect(() => {
    latestColumns.current = columns;
  });
  const getColumns = useCallback(() => toColumnIds(latestColumns.current), []);
  const allowed = state.from ? allowedTargets(state.from) : null;

  return (
    <DragDropProvider plugins={plugins} sensors={BOARD_SENSORS} {...handlers}>
      {/* Tràn ra lề của PAGE_CONTAINER: cột cuộn ngang tới sát mép màn, mép trái lúc chưa cuộn vẫn thẳng header. */}
      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6">
        {TASK_STATUS_ORDER.map((status) => (
          <BoardColumn
            key={status}
            status={status}
            tasks={view[status]}
            blockedFrom={allowed && !allowed.includes(status) ? state.from : null}
            isOver={state.over === status}
            canDrag={canDrag}
            pendingIds={pendingIds}
            reducedMotion={reducedMotion}
            onOpen={onOpen}
            getColumns={getColumns}
            onMove={onMove}
          />
        ))}
      </div>
      <DragOverlay {...(reducedMotion ? { dropAnimation: null } : {})}>
        {(source) => {
          const task = board.byId[String(source.id)];
          return task ? <TaskCard task={task} onOpen={noop} /> : null;
        }}
      </DragOverlay>
    </DragDropProvider>
  );
}
