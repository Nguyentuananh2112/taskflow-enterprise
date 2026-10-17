'use client';

import type { AttendanceKind } from '@taskflow/contracts/hr';
import { useState, type FormEvent } from 'react';

import { hrAttendanceApi } from '@/entities/hr';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Select } from '@/shared/ui/select';
import { Textarea } from '@/shared/ui/textarea';

import { usePunchChange } from '../model/use-punch-change';

type Props = Readonly<{ userId: string; date: string }>;

const KINDS = [
  { value: 'IN', label: 'Vào' },
  { value: 'OUT', label: 'Ra' },
  { value: 'OUT_NEXT', label: 'Ra sau 0 giờ (sáng hôm sau)' },
] as const;
type KindChoice = (typeof KINDS)[number]['value'];

/**
 * HR thêm lượt ADJUSTMENT (nhân viên quên chấm — §1 v1): giờ nhập theo LỊCH của ngày đó (server quy
 * đổi), "Ra sau 0 giờ" = `nextDay` (vẫn thuộc ngày công này — giờ chốt 06:00). Lý do bắt buộc, nhân
 * viên được thông báo.
 */
export function AddPunchForm({ userId, date }: Props) {
  const [kind, setKind] = useState<KindChoice>('IN');
  const [time, setTime] = useState('');
  const [reason, setReason] = useState('');
  const add = usePunchChange(
    userId,
    date,
    () =>
      hrAttendanceApi.adjust({
        userId,
        date,
        kind: (kind === 'IN' ? 'IN' : 'OUT') satisfies AttendanceKind,
        time,
        nextDay: kind === 'OUT_NEXT',
        reason: reason.trim(),
      }),
    'Đã thêm lượt chấm',
  );
  const submit = (event: FormEvent) => {
    event.preventDefault();
    add.mutate(undefined, {
      onSuccess: () => {
        setTime('');
        setReason('');
      },
    });
  };
  return (
    <form aria-label="Thêm lượt chấm" onSubmit={submit} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          label="Loại lượt"
          options={KINDS}
          value={kind}
          onChange={(e) => setKind(e.target.value as KindChoice)}
        />
        <Input
          label="Giờ"
          type="time"
          required
          value={time}
          onChange={(e) => setTime(e.target.value)}
        />
      </div>
      <Textarea
        label="Lý do"
        hint="Nhân viên sẽ thấy lý do này."
        rows={2}
        maxLength={500}
        required
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <Button
        type="submit"
        className="self-start"
        loading={add.isPending}
        disabled={!time || !reason.trim()}
      >
        Thêm lượt
      </Button>
    </form>
  );
}
