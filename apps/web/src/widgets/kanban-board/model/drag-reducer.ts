import type { TaskStatus } from '@taskflow/contracts/task';

import type { ColumnIds } from '@/features/task-move';

// State kéo tạm (frontend.md §3.1, §4.2): chỉ sống trong lúc kéo. Trong lúc kéo KHÔNG ghi vào Query
// cache — UI render từ `preview`; event socket vẫn merge vào cache bình thường.

export type DragState = Readonly<{
  activeId: string | null;
  /** Cột gốc của thẻ đang kéo — quyết định cột nào bị chặn (state machine). */
  from: TaskStatus | null;
  /** Cột lúc bắt đầu kéo — để tính hàng xóm cũ/mới. */
  before: ColumnIds | null;
  preview: ColumnIds | null;
}>;

export type DragAction =
  | { type: 'start'; activeId: string; from: TaskStatus; columns: ColumnIds }
  | { type: 'over'; preview: ColumnIds }
  | { type: 'end' };

export const IDLE: DragState = { activeId: null, from: null, before: null, preview: null };

export function dragReducer(state: DragState, action: DragAction): DragState {
  switch (action.type) {
    case 'start':
      return {
        activeId: action.activeId,
        from: action.from,
        before: action.columns,
        preview: action.columns,
      };
    case 'over':
      return state.activeId === null ? state : { ...state, preview: action.preview };
    case 'end':
      return IDLE;
  }
}
