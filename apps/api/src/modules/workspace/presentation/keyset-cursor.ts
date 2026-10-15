import { ValidationError } from '../../../core/errors';
import { afterFromCursor } from '../../../core/http/pagination';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Cursor của members / projects mang `after` = id (uuid). Cursor không ký ⇒ ai cũng tự tạo được;
 * `after` không phải uuid ⇒ cùng 400 `invalid_cursor` như mọi cursor hỏng, thay vì để Postgres ném
 * lỗi kiểu dữ liệu ⇒ 500 (X5, T-032).
 */
export function uuidAfterFromCursor(kind: string, cursor: string | undefined): string | undefined {
  const after = afterFromCursor(kind, cursor);
  if (after !== undefined && !UUID.test(after)) {
    throw new ValidationError([
      { path: ['cursor'], code: 'invalid_cursor', message: 'Cursor phân trang không hợp lệ.' },
    ]);
  }
  return after;
}
