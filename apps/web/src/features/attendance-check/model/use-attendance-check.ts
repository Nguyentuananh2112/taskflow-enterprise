import { ResourceConflictDetails } from '@taskflow/contracts/common';
import { useMutation } from '@tanstack/react-query';
import * as z from 'zod';

import { attendanceApi, attendanceKeys } from '@/entities/attendance';
import { CLIENT_ERROR_CODES, isApiError } from '@/shared/api';
import type { AttendanceTodayDto } from '@taskflow/contracts/attendance';
import { serverErrorMessage } from '@/shared/lib/form-errors';
import { toast } from '@/shared/ui/toast';

export type CheckKind = 'IN' | 'OUT';

// `BusinessRule` của contracts là enum đóng, chưa có luật Mốc 3 (T-038 sẽ thêm) ⇒ đọc lỏng `rule`.
const RuleDetails = z.object({ rule: z.string() });

/** Câu báo lỗi; trạng thái đã đổi ở nơi khác (tab khác vừa chấm) ⇒ nói rõ, không mã kỹ thuật. */
function checkErrorMessage(error: unknown): string {
  if (
    isApiError(error, 'RESOURCE_CONFLICT') &&
    ResourceConflictDetails.safeParse(error.details).data?.reason === 'already_checked_in'
  ) {
    return 'Hôm nay bạn đã chấm vào rồi.';
  }
  if (
    isApiError(error, 'BUSINESS_RULE_VIOLATION') &&
    RuleDetails.safeParse(error.details).data?.rule === 'NOT_CHECKED_IN'
  ) {
    return 'Bạn chưa chấm vào hôm nay nên chưa chấm ra được.';
  }
  return serverErrorMessage(error);
}

/**
 * Vào/Ra (attendance-leave.md §5). Mỗi lần BẤM sinh một Idempotency-Key (biến của mutation) ⇒ lỗi mạng
 * thì tự thử lại 1 lần với CÙNG key: server trả kết quả cũ thay vì tạo lượt thứ hai. Response là
 * `AttendanceTodayDto` ⇒ ghi thẳng vào cache, không GET lại.
 */
export function useAttendanceCheck(wsId: string) {
  return useMutation({
    mutationFn: ({ kind, key }: { kind: CheckKind; key: string }) =>
      kind === 'IN' ? attendanceApi.checkIn(wsId, key) : attendanceApi.checkOut(wsId, key),
    retry: (failures, error) =>
      failures < 1 && isApiError(error) && error.code === CLIENT_ERROR_CODES.network,
    onSuccess: (today: AttendanceTodayDto, { kind }, _r, context) => {
      context.client.setQueryData(attendanceKeys.today(wsId), today);
      void context.client.invalidateQueries({ queryKey: [...attendanceKeys.all(wsId), 'month'] });
      toast({ title: kind === 'IN' ? 'Đã chấm vào' : 'Đã chấm ra', tone: 'success' });
    },
    onError: (error, _v, _r, context) => {
      void context.client.invalidateQueries({ queryKey: attendanceKeys.today(wsId) });
      toast({ title: checkErrorMessage(error), tone: 'error' });
    },
  });
}

export const newCheckKey = () => crypto.randomUUID();
