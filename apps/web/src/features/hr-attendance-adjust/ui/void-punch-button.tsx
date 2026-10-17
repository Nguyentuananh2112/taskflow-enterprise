'use client';

import { useState } from 'react';

import { hrAttendanceApi } from '@/entities/hr';
import { Button } from '@/shared/ui/button';
import { Textarea } from '@/shared/ui/textarea';

import { usePunchChange } from '../model/use-punch-change';

type Props = Readonly<{
  userId: string;
  date: string;
  eventId: string;
  /** "Vào 08:10" — để nút và ô lý do có tên rõ ràng. */
  label: string;
}>;

/**
 * Hủy một lượt (log bất biến — ADR-121: lượt vẫn còn, gạch ngang, không tính công). Lý do bắt buộc;
 * mở ô lý do ngay tại chỗ thay vì dialog lồng dialog.
 */
export function VoidPunchButton({ userId, date, eventId, label }: Props) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const run = usePunchChange(
    userId,
    date,
    () => hrAttendanceApi.void(eventId, reason.trim()),
    `Đã hủy lượt ${label}`,
  );
  if (!open) {
    return (
      <Button
        size="sm"
        variant="ghost"
        aria-label={`Hủy lượt ${label}`}
        onClick={() => setOpen(true)}
      >
        Hủy lượt
      </Button>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <Textarea
        label={`Lý do hủy lượt ${label}`}
        rows={2}
        maxLength={500}
        required
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" onClick={() => setOpen(false)}>
          Thôi
        </Button>
        <Button
          size="sm"
          variant="danger"
          loading={run.isPending}
          disabled={!reason.trim()}
          onClick={() => run.mutate(undefined, { onSuccess: () => setOpen(false) })}
        >
          Xác nhận hủy
        </Button>
      </div>
    </div>
  );
}
