import { ResourceNotFoundError } from '../../../core/errors';
import type { IWorkspaceRepository } from './ports/repositories.port';

/**
 * X7 (T-032, security.md 3.6): lớp phòng thủ thứ hai sau middleware — request đang bay khi workspace
 * vừa bị xóa mềm không được thêm thành viên / project hay sửa gì trong ws đang chờ purge. Gọi TRONG
 * transaction; không tồn tại hoặc đã xóa ⇒ 404 workspace (cùng lỗi như middleware).
 */
export async function assertWorkspaceLive(
  workspaces: IWorkspaceRepository,
  workspaceId: string,
): Promise<void> {
  const ws = await workspaces.findById(workspaceId);
  if (!ws || ws.isDeleted) throw new ResourceNotFoundError('workspace');
}
