import { move } from '@dnd-kit/helpers';
import type { DragDropEventHandlers } from '@dnd-kit/react';
import type { TaskDto, TaskStatus } from '@taskflow/contracts/task';
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';

import { allowedTargets, STATUS_LABEL, type BoardColumns } from '@/entities/task';
import { computeMoveIntent, findColumn, toColumnIds, type MoveIntent } from '@/features/task-move';
import { toast } from '@/shared/ui/toast';

import { IDLE, dragReducer, type DragState } from './drag-reducer';

type Handlers = Partial<DragDropEventHandlers>;
type MutableColumns = Record<TaskStatus, string[]>;

/** Dữ liệu gắn vào droppable/sortable để biết cột đích khi kéo qua. */
export type DropData = Readonly<{ status: TaskStatus }>;

const statusOf = (data: unknown): TaskStatus | undefined =>
  typeof data === 'object' && data !== null && 'status' in data
    ? (data.status as TaskStatus)
    : undefined;

type Options = Readonly<{
  columns: BoardColumns;
  byId: Readonly<Record<string, TaskDto>>;
  onMove: (task: TaskDto, intent: MoveIntent) => void;
}>;

/**
 * onDragStart/Over/End → preview cục bộ → computeMoveIntent → mutate (frontend.md §4.2). Cột sai state
 * machine bị chặn 3 lớp: droppable `disabled` (UI), `preventDefault` ở dragover, kiểm lại ở dragend.
 */
export function useBoardDnd({ columns, byId, onMove }: Options) {
  const [state, dispatch] = useReducer(dragReducer, IDLE);
  // Handler đọc dữ liệu mới nhất qua ref (DragDropProvider giữ handler qua nhiều lần render).
  const drag = useRef<DragState>(IDLE);
  const latest = useRef({ columns, byId, onMove });
  useEffect(() => {
    latest.current = { columns, byId, onMove };
  });

  const onDragStart = useCallback<NonNullable<Handlers['onDragStart']>>((event) => {
    const id = event.operation.source?.id;
    const task = id === undefined ? undefined : latest.current.byId[String(id)];
    if (!task) return;
    const snapshot = toColumnIds(latest.current.columns);
    drag.current = {
      activeId: task.id,
      from: task.status,
      before: snapshot,
      preview: snapshot,
      over: null,
    };
    dispatch({ type: 'start', activeId: task.id, from: task.status, columns: snapshot });
  }, []);

  const onDragOver = useCallback<NonNullable<Handlers['onDragOver']>>((event) => {
    const { from, preview } = drag.current;
    const to = statusOf(event.operation.target?.data);
    if (from === null || preview === null) return;
    const allowed = to !== undefined && allowedTargets(from).includes(to);
    if (drag.current.over !== (allowed ? to : null)) {
      drag.current = { ...drag.current, over: allowed ? to : null };
      dispatch({ type: 'target', over: allowed ? to : null });
    }
    if (to !== undefined && !allowed) {
      event.preventDefault(); // chặn sắp xếp lạc quan mặc định; preview giữ nguyên
      return;
    }
    const next = move(preview as MutableColumns, event);
    if (next === preview) return;
    drag.current = { ...drag.current, preview: next };
    dispatch({ type: 'over', preview: next });
  }, []);

  const onDragEnd = useCallback<NonNullable<Handlers['onDragEnd']>>((event) => {
    const { activeId, from, before, preview } = drag.current;
    drag.current = IDLE;
    dispatch({ type: 'end' });
    if (event.canceled || !activeId || !from || !before || !preview) return;
    // Quyết định theo đích THẬT lúc thả, không theo preview: preview có thể còn giữ cột hợp lệ vừa đi
    // ngang (vd kéo Cần làm → Hoàn thành băng qua Đang làm trống — E2E-04). Không có đích ⇒ hủy.
    const target = statusOf(event.operation.target?.data);
    if (target === undefined) return;
    if (!allowedTargets(from).includes(target)) {
      toast({ title: `Không thể chuyển từ ${STATUS_LABEL[from]} sang ${STATUS_LABEL[target]}` });
      return;
    }
    if (findColumn(preview, activeId) !== target) return; // preview chưa kịp theo đích ⇒ không đoán
    const task = latest.current.byId[activeId];
    if (!task) {
      toast({ title: 'Task vừa bị xóa', tone: 'error' });
      return;
    }
    const intent = computeMoveIntent(before, preview, activeId);
    if (intent) latest.current.onMove(task, intent);
  }, []);

  const handlers = useMemo(
    () => ({ onDragStart, onDragOver, onDragEnd }),
    [onDragStart, onDragOver, onDragEnd],
  );
  return { state, handlers };
}
