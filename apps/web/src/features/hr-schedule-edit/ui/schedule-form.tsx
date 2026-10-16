'use client';

import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { minutesToClock } from '@/entities/attendance';
import { calendarErrorMessage, hrAttendanceApi, hrKeys } from '@/entities/hr';
import { CreateWorkScheduleBody } from '@taskflow/contracts/attendance';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { toast } from '@/shared/ui/toast';

import { WorkdayPicker } from './workday-picker';

type Shift = Readonly<{
  timezone: string;
  workdays: number;
  startMin: number;
  endMin: number;
  breakStartMin: number;
  breakEndMin: number;
  graceMin: number;
}>;
type Props = Readonly<{ wsId: string; today: string; current: Shift }>;

const toMin = (hhmm: string) => {
  const [h = NaN, m = NaN] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
const TIMES = [
  ['startMin', 'Bắt đầu ca'],
  ['endMin', 'Kết thúc ca'],
  ['breakStartMin', 'Nghỉ trưa từ'],
  ['breakEndMin', 'Nghỉ trưa đến'],
] as const;

/**
 * Lưu phiên bản lịch mới (ADR-121): chỉ hiệu lực từ hôm nay trở đi — tháng cũ không đổi. Trùng ngày hiệu
 * lực với phiên bản đã có ⇒ thay phiên bản đó (A). Kiểm hình dạng bằng chính schema của contracts.
 */
export function ScheduleForm({ wsId, today, current }: Props) {
  const [form, setForm] = useState({ ...current, effectiveFrom: today });
  const parsed = CreateWorkScheduleBody.safeParse(form);
  const issue = parsed.success ? undefined : parsed.error.issues[0];
  const save = useMutation({
    mutationFn: () => hrAttendanceApi.createSchedule(wsId, CreateWorkScheduleBody.parse(form)),
    onSuccess: (_d, _v, _r, context) => {
      void context.client.invalidateQueries({ queryKey: hrKeys.all(wsId) });
      toast({ title: 'Đã lưu lịch làm việc', tone: 'success' });
    },
    onError: (error) => toast({ title: calendarErrorMessage(error), tone: 'error' }),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (parsed.success) save.mutate();
  };
  return (
    <form aria-label="Lịch làm việc mới" onSubmit={submit} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="Áp dụng từ ngày"
          type="date"
          min={today}
          required
          value={form.effectiveFrom}
          onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })}
        />
        <Input
          label="Múi giờ"
          hint="IANA, vd Asia/Ho_Chi_Minh"
          value={form.timezone}
          error={issue?.path[0] === 'timezone' ? issue.message : undefined}
          onChange={(e) => setForm({ ...form, timezone: e.target.value })}
        />
      </div>
      <WorkdayPicker
        value={form.workdays}
        onChange={(workdays) => setForm({ ...form, workdays })}
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {TIMES.map(([key, label]) => (
          <Input
            key={key}
            label={label}
            type="time"
            required
            value={minutesToClock(form[key])}
            onChange={(e) => setForm({ ...form, [key]: toMin(e.target.value) })}
          />
        ))}
        <Input
          label="Cho phép muộn (phút)"
          type="number"
          min={0}
          max={120}
          value={form.graceMin}
          onChange={(e) => setForm({ ...form, graceMin: Number(e.target.value) })}
        />
      </div>
      {issue && issue.path[0] !== 'timezone' && (
        <p role="alert" className="text-sm text-danger">
          {issue.message}
        </p>
      )}
      <Button
        type="submit"
        className="self-start"
        loading={save.isPending}
        disabled={!parsed.success}
      >
        Lưu lịch
      </Button>
    </form>
  );
}
