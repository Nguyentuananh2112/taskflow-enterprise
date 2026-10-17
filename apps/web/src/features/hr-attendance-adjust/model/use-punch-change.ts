import type { AttendanceEventChangeDto } from '@taskflow/contracts/attendance';
import { useMutation } from '@tanstack/react-query';
import * as z from 'zod';

import { hrKeys, replaceTimesheetDay } from '@/entities/hr';
import { isApiError } from '@/shared/api';
import { toast } from '@/shared/ui/toast';

const Details = z.object({ rule: z.string().optional(), reason: z.string().optional() });

const RETENTION_MESSAGE = 'Ngày này đã quá thời hạn lưu dữ liệu, không thể chỉnh.';

/** Câu báo lỗi khi thêm / hủy lượt (A chốt: 403 tự sửa của mình, 409 already_voided, 404). */
export function punchErrorMessage(error: unknown): string {
  const d = isApiError(error) ? Details.safeParse(error.details).data : undefined;
  if (d?.reason === 'already_voided') return 'Lượt này đã bị hủy trước đó.';
  if (d?.rule === 'REASON_REQUIRED') return 'Cần ghi lý do.';
  // T-043b (R27): ngày công quá thời hạn lưu (mốc do server tính) — dữ liệu đã/ sẽ bị xóa, không sửa được.
  if (d?.rule === 'OUTSIDE_RETENTION') return RETENTION_MESSAGE;
  if (isApiError(error, 'FORBIDDEN_ACCESS')) {
    return 'Bạn không có quyền sửa chấm công này (không tự sửa chấm công của mình).';
  }
  if (isApiError(error, 'RESOURCE_NOT_FOUND')) return 'Không tìm thấy lượt chấm hoặc nhân viên.';
  if (isApiError(error, 'VALIDATION_ERROR')) return 'Dữ liệu chưa hợp lệ — kiểm tra giờ và lý do.';
  return 'Không lưu được. Vui lòng thử lại.';
}

/**
 * Thêm / hủy lượt: server trả `{ event, day, totals }` ⇒ thay đúng 1 ô + dòng tổng của người đó (TL chốt, không
 * refetch cả bảng, không tự cộng), tải lại danh sách lượt của ngày đó và "Hôm nay".
 */
export function usePunchChange<V>(
  userId: string,
  date: string,
  run: (vars: V) => Promise<AttendanceEventChangeDto>,
  done: string,
) {
  return useMutation({
    mutationFn: run,
    onSuccess: (change, _v, _r, context) => {
      replaceTimesheetDay(context.client, userId, change);
      void context.client.invalidateQueries({ queryKey: hrKeys.events(userId, date) });
      void context.client.invalidateQueries({ queryKey: hrKeys.today() });
      toast({ title: done, tone: 'success' });
    },
    onError: (error) => toast({ title: punchErrorMessage(error), tone: 'error' }),
  });
}
