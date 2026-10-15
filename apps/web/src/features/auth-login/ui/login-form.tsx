'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { LoginBody } from '@taskflow/contracts/auth';
import { useForm } from 'react-hook-form';

import { applyServerErrors } from '@/shared/lib/form-errors';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';

import { useLogin } from '../model/use-login';

const FIELDS = ['email', 'password'] as const;

/** Form đăng nhập — luật lấy thẳng từ `LoginBody` của contracts (frontend.md §7.2). */
export function LoginForm() {
  const login = useLogin();
  const { register, handleSubmit, setError, formState } = useForm({
    resolver: zodResolver(LoginBody),
  });
  const { errors, isSubmitting } = formState;

  const onSubmit = handleSubmit(async (values) => {
    try {
      await login.mutateAsync(values);
    } catch (error) {
      // INVALID_CREDENTIALS ⇒ lỗi gốc, không chỉ ra trường nào sai (security.md §6.5).
      applyServerErrors((name, e) => setError(name as (typeof FIELDS)[number], e), error, {
        fields: FIELDS,
      });
    }
  });

  return (
    <form noValidate onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-4">
      {errors.root?.server && <Alert>{errors.root.server.message}</Alert>}
      <Input
        label="Email"
        type="email"
        autoComplete="email"
        required
        error={errors.email?.message}
        {...register('email')}
      />
      <Input
        label="Mật khẩu"
        type="password"
        autoComplete="current-password"
        required
        error={errors.password?.message}
        {...register('password')}
      />
      <Button type="submit" loading={isSubmitting}>
        {isSubmitting ? 'Đang đăng nhập…' : 'Đăng nhập'}
      </Button>
    </form>
  );
}
