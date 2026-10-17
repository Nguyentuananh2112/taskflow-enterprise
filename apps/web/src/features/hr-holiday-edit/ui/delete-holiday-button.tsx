'use client';

import type { HolidayDto } from '@taskflow/contracts/attendance';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { calendarErrorMessage, hrAttendanceApi, hrKeys } from '@/entities/hr';
import { Button } from '@/shared/ui/button';
import { Dialog, DialogClose } from '@/shared/ui/dialog';
import { Input } from '@/shared/ui/input';
import { toast } from '@/shared/ui/toast';

type Props = Readonly<{ holiday: HolidayDto; past: boolean }>;

/** Xóa ngày lễ (204 idempotent). Ngày đã qua: chỉ Admin render nút này, bắt buộc lý do. */
export function DeleteHolidayButton({ holiday, past }: Props) {
  const [reason, setReason] = useState('');
  const remove = useMutation({
    mutationFn: () => hrAttendanceApi.deleteHoliday(holiday.date, past ? reason.trim() : undefined),
    onSuccess: (_d, _v, _r, context) => {
      void context.client.invalidateQueries({ queryKey: hrKeys.all() });
      toast({ title: `Đã xóa ngày lễ ${holiday.name}`, tone: 'success' });
    },
    onError: (error) => toast({ title: calendarErrorMessage(error), tone: 'error' }),
  });
  return (
    <Dialog
      trigger={
        <Button size="sm" variant="ghost" aria-label={`Xóa ngày lễ ${holiday.name}`}>
          Xóa
        </Button>
      }
      title={`Xóa ngày lễ ${holiday.name}?`}
      description={
        past
          ? 'Ngày này đã qua — bảng công của ngày đó sẽ tính lại như ngày thường.'
          : 'Ngày này sẽ được tính như ngày làm việc bình thường.'
      }
      footer={
        <>
          <DialogClose>
            <Button variant="secondary">Hủy</Button>
          </DialogClose>
          <Button
            variant="danger"
            loading={remove.isPending}
            disabled={past && !reason.trim()}
            onClick={() => remove.mutate()}
          >
            Xóa
          </Button>
        </>
      }
    >
      {past && (
        <Input
          label="Lý do"
          required
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      )}
    </Dialog>
  );
}
