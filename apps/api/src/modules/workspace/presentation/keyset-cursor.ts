import { ValidationError } from '../../../core/errors';
import { afterFromCursor } from '../../../core/http/pagination';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Cursor của members / projects mang `after` = id (uuid). Cursor không ký ⇒ ai cũng tự tạo được;
 * `after` không phải uuid ⇒ cùng 400 `invalid_cursor` như mọi cursor hỏng, thay vì để Postgres ném
 * lỗi kiểu dữ liệu ⇒ 500 (X5, T-032).
 *
 * LỚP DỰ PHÒNG CÓ CHỦ ĐÍCH (F3 mutation xếp EQ): hiện `afterFromCursor` (`core/http/pagination.ts`,
 * `AfterKey = z.object({ after: z.uuid() })`) đã từ chối mọi `after` không phải uuid nên nhánh `throw`
 * dưới đây không chạy. Giữ lại vì hai controller workspace gọi hàm này, và nếu `AfterKey` của core
 * được nới (vd cursor keyset nhiều trường cho endpoint khác) thì đây là chốt chặn 500 cho id uuid.
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
