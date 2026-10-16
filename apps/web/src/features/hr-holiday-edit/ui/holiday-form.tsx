'use client';

import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { calendarErrorMessage, hrAttendanceApi, hrKeys } from '@/entities/hr';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { toast } from '@/shared/ui/toast';

type Props = Readonly<{ wsId: string; today: string; isOwner: boolean }>;

/**
 * Thêm / đổi tên ngày lễ (PUT idempotent theo ngày). Ngày đã qua làm đổi bảng công cũ ⇒ chỉ OWNER, bắt
 * buộc lý do (ADR-121, A#4) — HR khác: ô ngày chặn từ hôm nay.
 */
export function HolidayForm({ wsId, today, isOwner }: Props) {
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [reason, setReason] = useState('');
  const past = date !== '' && date < today;
  const save = useMutation({
    mutationFn: () =>
      hrAttendanceApi.putHoliday(wsId, date, {
        name: name.trim(),
        ...(past ? { reason: reason.trim() } : {}),
      }),
    onSuccess: (_d, _v, _r, context) => {
      // Ngày lễ đổi trạng thái ngày ⇒ bảng công / hôm nay tính lại khi đọc.
      void context.client.invalidateQueries({ queryKey: hrKeys.all(wsId) });
      toast({ title: `Đã lưu ngày lễ ${name.trim()}`, tone: 'success' });
      setDate('');
      setName('');
      setReason('');
    },
    onError: (error) => toast({ title: calendarErrorMessage(error), tone: 'error' }),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };
  return (
    <form aria-label="Thêm ngày lễ" onSubmit={submit} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="Ngày"
          type="date"
          required
          min={isOwner ? undefined : today}
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <Input
          label="Tên ngày lễ"
          required
          maxLength={100}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      {past && (
        <Input
          label="Lý do sửa ngày đã qua"
          hint="Bảng công các tháng trước sẽ thay đổi theo."
          required
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      )}
      <Button
        type="submit"
        className="self-start"
        loading={save.isPending}
        disabled={!date || !name.trim() || (past && (!isOwner || !reason.trim()))}
      >
        Lưu ngày lễ
      </Button>
    </form>
  );
}
