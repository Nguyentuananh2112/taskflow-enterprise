'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ChangePasswordBody } from '@taskflow/contracts/auth';
import { useForm } from 'react-hook-form';

import { applyServerErrors } from '@/shared/lib/form-errors';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { ClientForm } from '@/shared/ui/client-form';
import { PasswordInput } from '@/shared/ui/password-input';
import { toast } from '@/shared/ui/toast';

import { useChangePassword } from '../model/use-change-password';

const FIELDS = ['currentPassword', 'newPassword'] as const;
/** Server cố ý trả 400 (không 401) để interceptor không nhầm là hết phiên — gắn vào ô hiện tại. */
const FIELD_BY_CODE = { INVALID_CURRENT_PASSWORD: 'currentPassword' } as const;

export function ChangePasswordForm() {
  const changePassword = useChangePassword();
  const { register, handleSubmit, setError, reset, formState } = useForm({
    resolver: zodResolver(ChangePasswordBody),
  });
  const { errors, isSubmitting } = formState;

  const onSubmit = handleSubmit(async (values) => {
    try {
      await changePassword.mutateAsync(values);
      reset();
      toast({
        title: 'Đã đổi mật khẩu',
        description: 'Các thiết bị khác đã bị đăng xuất.',
        tone: 'success',
      });
    } catch (error) {
      applyServerErrors((name, e) => setError(name as (typeof FIELDS)[number], e), error, {
        fields: FIELDS,
        fieldByCode: FIELD_BY_CODE,
      });
    }
  });

  return (
    <ClientForm onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-4">
      {errors.root?.server && <Alert>{errors.root.server.message}</Alert>}
      <PasswordInput
        label="Mật khẩu hiện tại"
        rules={[]}
        autoComplete="current-password"
        required
        error={errors.currentPassword?.message}
        {...register('currentPassword')}
      />
      <PasswordInput
        label="Mật khẩu mới"
        autoComplete="new-password"
        required
        error={errors.newPassword?.message}
        {...register('newPassword')}
      />
      <Button type="submit" loading={isSubmitting} className="self-start">
        Đổi mật khẩu
      </Button>
    </ClientForm>
  );
}
