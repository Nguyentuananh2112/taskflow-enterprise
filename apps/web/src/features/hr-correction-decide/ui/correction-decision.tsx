'use client';

import type { CorrectionDto } from '@taskflow/contracts/attendance';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import {
  correctionApi,
  correctionErrorMessage,
  correctionKeys,
  correctionRule,
} from '@/entities/correction';
import { hrKeys, replaceTimesheetDay } from '@/entities/hr';
import { isApiError } from '@/shared/api';
import { Button } from '@/shared/ui/button';
import { Dialog, DialogClose } from '@/shared/ui/dialog';
import { Textarea } from '@/shared/ui/textarea';
import { toast } from '@/shared/ui/toast';

type Action = 'approve' | 'reject';

/** Lỗi khi duyệt mà đơn vẫn từ chối được (hết cửa sổ, người gửi đã nghỉ / thành Admin, luật ngày đã đổi). */
const ONLY_REJECT = new Set([
  'REQUESTER_NOT_EMPLOYEE',
  'CORRECTION_DATE_OUT_OF_RANGE',
  'OUTSIDE_RETENTION',
  'CORRECTION_EVENT_EXISTS',
  'CORRECTION_TIME_ORDER',
  'CORRECTION_DAY_ON_LEAVE',
]);

type Props = Readonly<{
  request: CorrectionDto;
  /** Đơn của chính mình: luật self TUYỆT ĐỐI (ADR-129) — không ai tự duyệt, kể cả Admin. */
  own: boolean;
}>;

/**
 * Duyệt / Từ chối đơn bổ sung giờ (`hr:manage`) với `expectedVersion`; ghi chú tùy chọn (người gửi thấy). Duyệt = tạo
 * lượt ADJUSTMENT như HR thêm tay ⇒ thay đúng ô + tổng của người đó trong bảng công tháng đang cache.
 */
export function CorrectionDecision({ request, own }: Props) {
  const [action, setAction] = useState<Action | null>(null);
  const [state, setState] = useState({ note: '', onlyReject: false });
  const name = request.user.fullName;
  const decide = useMutation({
    mutationFn: async (a: Action) => {
      const body = {
        expectedVersion: request.version,
        ...(state.note.trim() ? { note: state.note.trim() } : {}),
      };
      if (a === 'approve') return correctionApi.approve(request.id, body);
      // Từ chối không đổi bảng công ⇒ không có ô / tổng mới.
      return correctionApi.reject(request.id, body).then(() => null);
    },
    onSuccess: (r, a, _c, context) => {
      if (r) replaceTimesheetDay(context.client, request.userId, r);
      void context.client.invalidateQueries({
        queryKey: hrKeys.events(request.userId, request.date),
      });
      toast({
        title: `${a === 'approve' ? 'Đã duyệt' : 'Đã từ chối'} đơn của ${name}`,
        tone: 'success',
      });
      setAction(null);
    },
    onError: (error) => {
      const rule = correctionRule(error);
      if (rule && ONLY_REJECT.has(rule)) setState((s) => ({ ...s, onlyReject: true }));
      toast({ title: correctionErrorMessage(error), tone: 'error' });
      setAction(null);
    },
    onSettled: (_d, error, _a, _r, context) => {
      if (
        error &&
        !isApiError(error, 'RESOURCE_CONFLICT') &&
        !isApiError(error, 'VERSION_CONFLICT')
      )
        return;
      void context.client.invalidateQueries({ queryKey: correctionKeys.hrAll() });
    },
  });
  if (request.status !== 'PENDING') return null;
  if (own) {
    return (
      <Button size="sm" variant="secondary" disabled>
        Người khác duyệt
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {state.onlyReject && <span className="text-xs text-text-muted">Chỉ có thể từ chối</span>}
      <Button
        size="sm"
        disabled={state.onlyReject}
        aria-label={`Duyệt đơn bổ sung giờ của ${name}`}
        onClick={() => setAction('approve')}
      >
        Duyệt
      </Button>
      <Button
        size="sm"
        variant="secondary"
        aria-label={`Từ chối đơn bổ sung giờ của ${name}`}
        onClick={() => setAction('reject')}
      >
        Từ chối
      </Button>
      <Dialog
        open={action !== null}
        onOpenChange={(open) => !open && setAction(null)}
        title={`${action === 'approve' ? 'Duyệt' : 'Từ chối'} đơn bổ sung giờ của ${name}?`}
        footer={
          <>
            <DialogClose>
              <Button variant="secondary">Hủy</Button>
            </DialogClose>
            <Button
              variant={action === 'approve' ? 'primary' : 'danger'}
              loading={decide.isPending}
              onClick={() => action && decide.mutate(action)}
            >
              {action === 'approve' ? 'Duyệt' : 'Từ chối'}
            </Button>
          </>
        }
      >
        <Textarea
          label="Ghi chú (tùy chọn)"
          hint="Người gửi sẽ thấy ghi chú này."
          rows={2}
          maxLength={500}
          value={state.note}
          onChange={(e) => setState((s) => ({ ...s, note: e.target.value }))}
        />
      </Dialog>
    </div>
  );
}
