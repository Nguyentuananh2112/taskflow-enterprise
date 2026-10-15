'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { UpdateMeBody, type UserDto } from '@taskflow/contracts/auth';
import { useForm } from 'react-hook-form';

import { applyServerErrors } from '@/shared/lib/form-errors';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { toast } from '@/shared/ui/toast';

import { useUpdateMe } from '../model/use-update-me';

const FIELDS = ['fullName'] as const;

/** Sửa họ tên (ADR-083). Email chỉ hiển thị — đổi email không có ở v1. */
export function ProfileForm({ user }: Readonly<{ user: UserDto }>) {
  const updateMe = useUpdateMe();
  const { register, handleSubmit, setError, formState } = useForm({
    resolver: zodResolver(UpdateMeBody),
    defaultValues: { fullName: user.fullName },
  });
  const { errors, isSubmitting } = formState;

  const onSubmit = handleSubmit(async (values) => {
    try {
      await updateMe.mutateAsync(values);
      toast({ title: 'Đã lưu họ tên', tone: 'success' });
    } catch (error) {
      applyServerErrors((name, e) => setError(name as 'fullName', e), error, { fields: FIELDS });
    }
  });

  return (
    <form noValidate onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-4">
      {errors.root?.server && <Alert>{errors.root.server.message}</Alert>}
      <Input label="Email" value={user.email} readOnly disabled autoComplete="email" />
      <Input
        label="Họ tên"
        autoComplete="name"
        required
        error={errors.fullName?.message}
        {...register('fullName')}
      />
      <Button type="submit" loading={isSubmitting} className="self-start">
        Lưu họ tên
      </Button>
    </form>
  );
}
