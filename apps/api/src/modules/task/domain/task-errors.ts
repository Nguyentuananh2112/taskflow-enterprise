/**
 * Bất biến: task đã xóa mềm không được thay đổi nữa (test-spec TE-D02/D03). Use case luôn trả 404
 * trước khi tới đây, nên lỗi này chỉ lộ ra khi có bug ⇒ không phải AppError (thành 500 nếu lọt).
 */
export class TaskAlreadyDeletedError extends Error {
  constructor(readonly taskId: string) {
    super(`Task ${taskId} đã bị xóa — không thể thay đổi.`);
    this.name = 'TaskAlreadyDeletedError';
  }
}
