'use client';

import type { LeaveRequestDto } from '@taskflow/contracts/leave';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { hrKeys, hrLeaveApi } from '@/entities/hr';
import { Button } from '@/shared/ui/button';
import { Dialog, DialogClose } from '@/shared/ui/dialog';
import { Textarea } from '@/shared/ui/textarea';
import { toast } from '@/shared/ui/toast';

import { decideErrorMessage } from '../model/decide-errors';

type Action = 'approve' | 'reject' | 'revoke';

const COPY: Record<Action, { button: string; title: string; done: string; label: string }> = {
  approve: { button: 'Duyệt', title: 'Duyệt đơn của', done: 'Đã duyệt đơn', label: 'Ghi chú' },
  reject: { button: 'Từ chối', title: 'Từ chối đơn của', done: 'Đã từ chối đơn', label: 'Ghi chú' },
  revoke: {
    button: 'Thu hồi',
    title: 'Thu hồi đơn đã duyệt của',
    done: 'Đã thu hồi đơn',
    label: 'Lý do thu hồi',
  },
};

type Props = Readonly<{
  request: LeaveRequestDto;
  /** Ngày theo lịch (server) — chỉ thu hồi đơn APPROVED chưa tới ngày bắt đầu (§9). */
  today: string;
  /** Đơn của chính mình: chỉ Admin tự xử lý được và PHẢI ghi lý do (B-H1). */
  own: boolean;
}>;

/**
 * Nút Duyệt / Từ chối (PENDING) và Thu hồi (APPROVED, chưa bắt đầu) — gửi `expectedVersion` (§9). Ghi chú
 * tùy chọn khi duyệt/từ chối; thu hồi hoặc tự xử lý đơn của mình ⇒ bắt buộc. Ghi chú KHÔNG chép lý do
 * nghỉ (dữ liệu sức khỏe — B-H2): gợi ý ngay dưới ô nhập.
 */
export function LeaveDecision({ request, today, own }: Props) {
  const [action, setAction] = useState<Action | null>(null);
  const [note, setNote] = useState('');
  const required = action === 'revoke' || own;
  const decide = useMutation({
    mutationFn: (a: Action) =>
      hrLeaveApi.decide(request.id, a, {
        expectedVersion: request.version,
        ...(note.trim() ? { note: note.trim() } : {}),
      }),
    onSuccess: (_dto, a) => {
      toast({ title: `${COPY[a].done} của ${request.user.fullName}`, tone: 'success' });
      setAction(null);
      setNote('');
    },
    onError: (error) => toast({ title: decideErrorMessage(error).text, tone: 'error' }),
    onSettled: (_d, error, _a, _r, context) => {
      if (error && !decideErrorMessage(error).stale) return;
      void context.client.invalidateQueries({ queryKey: hrKeys.leave() });
      void context.client.invalidateQueries({
        queryKey: hrKeys.balances(Number(request.startDate.slice(0, 4))),
      });
      if (error) setAction(null);
    },
  });
  const actions: Action[] =
    request.status === 'PENDING'
      ? ['approve', 'reject']
      : request.status === 'APPROVED' && request.startDate > today
        ? ['revoke']
        : [];
  if (actions.length === 0) return null;
  const copy = action ? COPY[action] : null;
  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((a) => (
        <Button
          key={a}
          size="sm"
          variant={a === 'approve' ? 'primary' : 'secondary'}
          aria-label={`${COPY[a].button} đơn của ${request.user.fullName}`}
          onClick={() => setAction(a)}
        >
          {COPY[a].button}
        </Button>
      ))}
      <Dialog
        open={action !== null}
        onOpenChange={(open) => !open && setAction(null)}
        title={copy ? `${copy.title} ${request.user.fullName}?` : ''}
        footer={
          <>
            <DialogClose>
              <Button variant="secondary">Hủy</Button>
            </DialogClose>
            <Button
              variant={action === 'approve' ? 'primary' : 'danger'}
              loading={decide.isPending}
              disabled={required && !note.trim()}
              onClick={() => action && decide.mutate(action)}
            >
              {copy?.button ?? ''}
            </Button>
          </>
        }
      >
        <Textarea
          label={`${copy?.label ?? 'Ghi chú'}${required ? '' : ' (tùy chọn)'}`}
          hint="Người gửi sẽ thấy ghi chú này. Không ghi thông tin sức khỏe."
          rows={3}
          maxLength={500}
          required={required}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Dialog>
    </div>
  );
}
