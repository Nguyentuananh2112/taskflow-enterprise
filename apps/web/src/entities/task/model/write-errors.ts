import {
  InvalidStatusTransitionDetails,
  VersionConflictDetails,
  type TaskDto,
} from '@taskflow/contracts/task';
import type { QueryClient } from '@tanstack/react-query';

import { projectKeys } from '@/entities/project/@x/task';
import { workspaceKeys } from '@/entities/workspace/@x/task';
import { isApiError } from '@/shared/api';
import { toast } from '@/shared/ui/toast';

import type { TaskScope } from '../api/task.api';
import { mergeIfNewer, removeTask, revertTask } from './board-cache';
import { STATUS_LABEL } from './labels';
import { taskKeys } from './query-keys';
import { updateBoard } from './use-board';

// Xử lý lỗi chung cho lệnh ghi task (frontend.md §4.4, bảng lỗi). Rollback THEO TỪNG TASK, có điều
// kiện (`revertTask`) — không khôi phục snapshot cả board.

export type WriteErrorContext = Readonly<{ client: QueryClient; scope: TaskScope; base: TaskDto }>;

/** Phiên đang kết thúc: SessionEffects đã báo, không toast thêm (frontend.md §3.3). */
const SESSION_CODES = new Set(['UNAUTHORIZED', 'TOKEN_EXPIRED']);

export function conflictCurrent(error: unknown): TaskDto | null {
  if (!isApiError(error, 'VERSION_CONFLICT')) return null;
  const details = VersionConflictDetails.safeParse(error.details);
  return details.success ? details.data.current : null;
}

export function handleTaskWriteError(error: unknown, ctx: WriteErrorContext): void {
  const { client, scope, base } = ctx;
  const revert = () => updateBoard(client, scope, (board) => revertTask(board, base));
  const refetchBoard = () =>
    void client.invalidateQueries({ queryKey: taskKeys.board(scope.wsId, scope.projectId) });
  if (!isApiError(error)) {
    revert();
    toast({ title: 'Không lưu được thay đổi', description: 'Vui lòng thử lại.', tone: 'error' });
    return;
  }
  if (SESSION_CODES.has(error.code)) return revert();
  switch (error.code) {
    case 'VERSION_CONFLICT': {
      const current = conflictCurrent(error);
      if (current) {
        updateBoard(client, scope, (board) => mergeIfNewer(board, current));
      } else {
        revert();
        refetchBoard();
      }
      return void toast({
        title: `${base.key} vừa được người khác cập nhật`,
        description: 'Đã hiển thị bản mới nhất.',
      });
    }
    case 'INVALID_STATUS_TRANSITION': {
      revert();
      // FE lẽ ra đã chặn ⇒ bảng chuyển trạng thái FE lệch với server.
      console.warn('[task] INVALID_STATUS_TRANSITION lọt qua chặn phía client', error.details);
      const details = InvalidStatusTransitionDetails.safeParse(error.details);
      const to = details.success ? STATUS_LABEL[details.data.to] : 'trạng thái này';
      const allowed = details.success ? details.data.allowed.map((s) => STATUS_LABEL[s]) : [];
      return void toast({
        title: `Không thể chuyển sang ${to}`,
        ...(allowed.length > 0 ? { description: `Được phép: ${allowed.join(', ')}` } : {}),
        tone: 'error',
      });
    }
    case 'PROJECT_ARCHIVED':
      revert();
      void client.invalidateQueries({
        queryKey: projectKeys.detail(scope.wsId, scope.projectId),
        exact: true,
      });
      return void toast({ title: 'Dự án đã được lưu trữ — chỉ đọc', tone: 'error' });
    case 'FORBIDDEN_ACCESS':
      revert();
      // Role có thể vừa đổi (frontend.md §3.4) — chỉ key workspace, không phải cả cây ['ws', id].
      void client.invalidateQueries({ queryKey: workspaceKeys.detail(scope.wsId), exact: true });
      return void toast({ title: 'Bạn không có quyền thực hiện thao tác này', tone: 'error' });
    case 'RESOURCE_NOT_FOUND':
      updateBoard(client, scope, (board) => removeTask(board, base.id));
      return void toast({ title: `${base.key} không còn tồn tại`, tone: 'error' });
    case 'BUSINESS_RULE_VIOLATION':
    case 'RESOURCE_CONFLICT':
      revert();
      refetchBoard();
      return void toast({
        title: 'Bảng vừa thay đổi',
        description: 'Vui lòng thử lại.',
        tone: 'error',
      });
    default:
      revert();
      return void toast({
        title: 'Không lưu được thay đổi',
        description: error.requestId
          ? `Vui lòng thử lại. Mã yêu cầu: ${error.requestId.slice(0, 8)}`
          : 'Vui lòng thử lại.',
        tone: 'error',
      });
  }
}
