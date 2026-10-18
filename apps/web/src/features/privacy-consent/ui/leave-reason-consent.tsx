'use client';

import type { PrivacyDto } from '@taskflow/contracts/privacy';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { leaveKeys } from '@/entities/leave';
import { privacyApi, privacyKeys } from '@/entities/privacy';
import { serverErrorMessage } from '@/shared/lib/form-errors';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Dialog } from '@/shared/ui/dialog';
import { toast } from '@/shared/ui/toast';

const WITHDRAW_WARNING = 'Lý do ở các đơn nghỉ đang chờ duyệt của bạn sẽ bị xóa.';

const at = (iso: string) =>
  new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(new Date(iso));

/**
 * Ô đồng ý RIÊNG cho lý do nghỉ (data-retention.md §5, T-075): chưa đồng ý ⇒ ô lý do của đơn nghỉ bị khóa (server chặn
 * 422 LEAVE_REASON_CONSENT_REQUIRED). Rút lại ⇒ hỏi lại vì lý do ở các đơn đang chờ bị xóa (TL chốt theo soát của B).
 * Hiện thời điểm đã ghi nhận làm bằng chứng cho người dùng (B L2).
 */
export function LeaveReasonConsent({ privacy }: Readonly<{ privacy: PrivacyDto }>) {
  const [confirming, setConfirming] = useState(false);
  const save = useMutation({
    mutationFn: (leaveReason: boolean) => privacyApi.consent(leaveReason),
    onSuccess: (next, _v, _r, context) => {
      context.client.setQueryData(privacyKeys.me(), next);
      // Rút lại ⇒ server đã xóa lý do của đơn đang chờ ⇒ "Đơn của tôi" tải lại.
      if (next.clearedPendingReasons > 0) {
        void context.client.invalidateQueries({ queryKey: leaveKeys.all() });
      }
      setConfirming(false);
      const cleared = next.clearedPendingReasons;
      toast({
        title: next.consentLeaveReason ? 'Đã ghi nhận đồng ý' : 'Đã rút lại đồng ý',
        ...(cleared > 0
          ? { description: `Đã xóa lý do ở ${String(cleared)} đơn đang chờ duyệt.` }
          : {}),
        tone: 'success',
      });
    },
  });
  const when = privacy.consentLeaveReasonAt;
  return (
    <div className="flex flex-col gap-2">
      {save.isError && <Alert>{serverErrorMessage(save.error)}</Alert>}
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={privacy.consentLeaveReason}
          disabled={save.isPending}
          onChange={(e) => (e.target.checked ? save.mutate(true) : setConfirming(true))}
        />
        <span>
          Tôi đồng ý để công ty xử lý <strong>lý do nghỉ</strong> (nếu tôi ghi) cho mục đích duyệt
          nghỉ.
          <span className="block text-xs text-text-muted">
            Không đồng ý vẫn gửi đơn nghỉ được — chỉ không ghi được lý do. Rút lại lúc nào cũng
            được: {WITHDRAW_WARNING.toLowerCase()}
          </span>
        </span>
      </label>
      {when && (
        <p className="text-xs text-text-muted">
          {privacy.consentLeaveReason ? 'Đã ghi nhận đồng ý lúc' : 'Đã rút lại đồng ý lúc'}{' '}
          {at(when)}.
        </p>
      )}
      <Dialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Rút lại đồng ý?"
        description={WITHDRAW_WARNING}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Hủy
            </Button>
            <Button loading={save.isPending} onClick={() => save.mutate(false)}>
              Rút lại đồng ý
            </Button>
          </>
        }
      />
    </div>
  );
}
