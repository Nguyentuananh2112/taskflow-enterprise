'use client';

import type { PrivacyDto } from '@taskflow/contracts/privacy';
import { useMutation } from '@tanstack/react-query';

import { privacyApi, privacyKeys } from '@/entities/privacy';
import { serverErrorMessage } from '@/shared/lib/form-errors';
import { Alert } from '@/shared/ui/alert';
import { toast } from '@/shared/ui/toast';

/**
 * Ô đồng ý RIÊNG cho lý do nghỉ (data-retention.md §5, T-075): chưa đồng ý ⇒ ô lý do của đơn nghỉ bị khóa (server chặn
 * 400 LEAVE_REASON_CONSENT_REQUIRED). Rút lại đồng ý không xóa lý do cũ (job 13 tháng vẫn xóa).
 */
export function LeaveReasonConsent({ privacy }: Readonly<{ privacy: PrivacyDto }>) {
  const save = useMutation({
    mutationFn: (leaveReason: boolean) => privacyApi.consent(leaveReason),
    onSuccess: (next, _v, _r, context) => {
      context.client.setQueryData(privacyKeys.me(), next);
      toast({
        title: next.consentLeaveReason ? 'Đã ghi nhận đồng ý' : 'Đã rút lại đồng ý',
        tone: 'success',
      });
    },
  });
  return (
    <div className="flex flex-col gap-2">
      {save.isError && <Alert>{serverErrorMessage(save.error)}</Alert>}
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={privacy.consentLeaveReason}
          disabled={save.isPending}
          onChange={(e) => save.mutate(e.target.checked)}
        />
        <span>
          Tôi đồng ý để công ty xử lý <strong>lý do nghỉ</strong> (nếu tôi ghi) cho mục đích duyệt
          nghỉ.
          <span className="block text-xs text-text-muted">
            Không đồng ý vẫn gửi đơn nghỉ được — chỉ không ghi được lý do. Rút lại lúc nào cũng
            được; lý do đã ghi vẫn tự xóa sau 13 tháng.
          </span>
        </span>
      </label>
    </div>
  );
}
