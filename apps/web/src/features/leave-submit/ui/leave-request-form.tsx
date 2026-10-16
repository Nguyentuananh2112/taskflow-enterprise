'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { LeaveDayPart, LeaveType } from '@taskflow/contracts/hr';
import { useMutation } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useForm, useWatch } from 'react-hook-form';

import { DAY_PART_NAME, LEAVE_TYPE_NAME, leaveApi, leaveKeys } from '@/entities/leave';
import { SubmitLeaveBody } from '@taskflow/contracts/leave';
import { applyServerErrors } from '@/shared/lib/form-errors';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { ClientForm } from '@/shared/ui/client-form';
import { Input } from '@/shared/ui/input';
import { Select } from '@/shared/ui/select';
import { Textarea } from '@/shared/ui/textarea';
import { toast } from '@/shared/ui/toast';

import { leaveSubmitError } from '../model/leave-errors';
import { LeavePreview } from './leave-preview';

const FIELDS = ['type', 'startDate', 'endDate', 'dayPart', 'reason'] as const;
const TYPES = LeaveType.options.map((v) => ({ value: v, label: LEAVE_TYPE_NAME[v] }));
const PARTS = LeaveDayPart.options.map((v) => ({ value: v, label: DAY_PART_NAME[v] }));

type Props = Readonly<{ wsId: string; today: string }>;

/** Gửi đơn nghỉ (attendance-leave.md §6). Số ngày do SERVER tính theo lịch + ngày lễ. */
export function LeaveRequestForm({ wsId, today }: Props) {
  const create = useMutation({
    mutationFn: (body: SubmitLeaveBody) => leaveApi.create(wsId, body),
    onSuccess: (_r, _b, _x, context) =>
      void context.client.invalidateQueries({ queryKey: leaveKeys.all(wsId) }),
  });
  const { register, handleSubmit, setError, reset, control, setValue, formState } = useForm({
    resolver: zodResolver(SubmitLeaveBody),
    defaultValues: {
      type: 'ANNUAL' as const,
      startDate: today,
      endDate: today,
      dayPart: 'FULL' as const,
      reason: '',
    },
  });
  const { errors, isSubmitting } = formState;
  const [type, startDate, endDate, dayPart] = useWatch({
    control,
    name: ['type', 'startDate', 'endDate', 'dayPart'],
  });
  const oneDay = startDate === endDate;
  // Chỉ xem trước khi khoảng ngày hợp lệ (cùng luật với schema gửi).
  const draft =
    startDate && endDate && endDate >= startDate && (oneDay || dayPart === 'FULL')
      ? { type, startDate, endDate, dayPart: dayPart ?? 'FULL' }
      : null;
  // Nhiều ngày ⇒ chỉ "Cả ngày" (field disabled bị react-hook-form bỏ giá trị ⇒ không dùng disabled).
  useEffect(() => {
    if (!oneDay) setValue('dayPart', 'FULL');
  }, [oneDay, setValue]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      const created = await create.mutateAsync(values);
      reset({ ...values, reason: '' });
      toast({ title: `Đã gửi đơn — ${created.days} ngày, chờ duyệt`, tone: 'success' });
    } catch (error) {
      const known = leaveSubmitError(error);
      if (known.field) return setError(known.field, { type: 'server', message: known.message });
      if (known.message) return setError('root.server', { type: 'server', message: known.message });
      applyServerErrors((name, e) => setError(name as (typeof FIELDS)[number], e), error, {
        fields: FIELDS,
      });
    }
  });

  return (
    <ClientForm
      onSubmit={(event) => void onSubmit(event)}
      aria-label="Gửi đơn nghỉ"
      className="flex flex-col gap-4"
    >
      {errors.root?.server && <Alert>{errors.root.server.message}</Alert>}
      <Select
        label="Loại nghỉ"
        options={TYPES}
        error={errors.type?.message}
        {...register('type')}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Input
          label="Từ ngày"
          type="date"
          required
          error={errors.startDate?.message}
          {...register('startDate')}
        />
        <Input
          label="Đến ngày"
          type="date"
          required
          error={errors.endDate?.message}
          {...register('endDate')}
        />
        <Select
          label="Buổi"
          options={oneDay ? PARTS : PARTS.slice(0, 1)}
          hint={oneDay ? undefined : 'Nghỉ nửa ngày chỉ áp dụng cho một ngày'}
          error={errors.dayPart?.message}
          {...register('dayPart')}
        />
      </div>
      <LeavePreview wsId={wsId} draft={draft} />
      <Textarea
        label="Lý do (không bắt buộc)"
        rows={3}
        maxLength={1000}
        hint="Không cần ghi bệnh hay chẩn đoán — chỉ HR và bạn xem được."
        error={errors.reason?.message}
        {...register('reason')}
      />
      <Button type="submit" loading={isSubmitting} className="self-start">
        Gửi đơn
      </Button>
    </ClientForm>
  );
}
