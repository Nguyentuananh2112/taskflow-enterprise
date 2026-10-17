'use client';

import type { AttendanceDayDto } from '@taskflow/contracts/attendance';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import {
  correctionApi,
  correctionAsk,
  correctionErrorMessage,
  correctionKeys,
  useMyCorrections,
} from '@/entities/correction';
import { Button } from '@/shared/ui/button';
import { toast } from '@/shared/ui/toast';

import { correctionKindFor } from '../lib/correction-kind';
import { CorrectionForm } from './correction-form';

type Props = Readonly<{ day: AttendanceDayDto; today: string }>;

/**
 * Trong chi tiết ngày (T-046): thiếu giờ ra ⇒ "Xin bổ sung giờ ra"; vắng / có ra không có vào ⇒ "Xin bổ sung giờ vào";
 * đã có đơn chờ ⇒ "Đã gửi đơn — chờ duyệt" + "Hủy đơn". Ngày không cần đơn ⇒ không hiện gì.
 */
export function CorrectionDayAction({ day, today }: Props) {
  const kind = correctionKindFor(day, today);
  const mine = useMyCorrections(kind !== null);
  const [open, setOpen] = useState(false);
  const pending = mine.data?.pages
    .flatMap((p) => p.data)
    .find((c) => c.date === day.date && c.kind === kind && c.status === 'PENDING');
  const cancel = useMutation({
    mutationFn: () => correctionApi.cancel(pending?.id ?? '', pending?.version ?? 1),
    onSuccess: (_r, _v, _c, context) => {
      void context.client.invalidateQueries({ queryKey: correctionKeys.mine() });
      toast({ title: 'Đã hủy đơn bổ sung giờ', tone: 'success' });
    },
    onError: (error) => toast({ title: correctionErrorMessage(error), tone: 'error' }),
  });
  if (kind === null || !mine.data) return null;
  if (pending) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-card bg-bg-subtle p-3 text-sm">
        <span className="flex-1">
          Đã gửi đơn ({correctionAsk(pending).toLowerCase()}) — chờ duyệt
        </span>
        <Button
          size="sm"
          variant="secondary"
          loading={cancel.isPending}
          onClick={() => cancel.mutate()}
        >
          Hủy đơn
        </Button>
      </div>
    );
  }
  if (open) return <CorrectionForm date={day.date} kind={kind} onDone={() => setOpen(false)} />;
  return (
    <Button variant="secondary" className="self-start" onClick={() => setOpen(true)}>
      {kind === 'OUT' ? 'Xin bổ sung giờ ra' : 'Xin bổ sung giờ vào'}
    </Button>
  );
}
