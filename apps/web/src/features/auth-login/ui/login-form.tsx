'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { LoginBody } from '@taskflow/contracts/auth';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { isApiError } from '@/shared/api';
import { applyServerErrors } from '@/shared/lib/form-errors';
import { useCountdown } from '@/shared/lib/use-countdown';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { ClientForm } from '@/shared/ui/client-form';
import { Input } from '@/shared/ui/input';

import { useLogin } from '../model/use-login';

const FIELDS = ['email', 'password'] as const;

/** Form đăng nhập — luật lấy thẳng từ `LoginBody` của contracts (frontend.md §7.2). */
export function LoginForm() {
  const login = useLogin();
  const [readyAgain, setReadyAgain] = useState(false);
  const { register, handleSubmit, setError, clearErrors, formState } = useForm({
    resolver: zodResolver(LoginBody),
  });
  // Hết thời gian chờ ⇒ gỡ thông báo rate limit (đã cũ) + báo có thể đăng nhập lại.
  const cooldown = useCountdown(() => {
    clearErrors('root');
    setReadyAgain(true);
  });
  const { errors, isSubmitting } = formState;
  const waiting = cooldown.remaining > 0;

  const onSubmit = handleSubmit(async (values) => {
    setReadyAgain(false);
    try {
      await login.mutateAsync(values);
    } catch (error) {
      // INVALID_CREDENTIALS ⇒ lỗi gốc, không chỉ ra trường nào sai (security.md §6.5).
      applyServerErrors((name, e) => setError(name as (typeof FIELDS)[number], e), error, {
        fields: FIELDS,
      });
      // RATE_LIMITED ⇒ khóa nút + đếm ngược theo `retryAfterSec` (frontend.md §1.2). Thông báo lỗi
      // (role=alert) đọc MỘT lần; con số chạy trên nút để trình đọc màn hình không bị đọc mỗi giây.
      const retryAfter = isApiError(error, 'RATE_LIMITED')
        ? (error.details as { retryAfterSec?: unknown } | null)?.retryAfterSec
        : undefined;
      if (typeof retryAfter === 'number' && retryAfter > 0) cooldown.start(retryAfter);
    }
  });

  return (
    <ClientForm onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-4">
      {errors.root?.server && <Alert>{errors.root.server.message}</Alert>}
      {/* Báo (lịch sự) khi hết thời gian chờ rate limit — con số đếm ngược chỉ hiện trên nút. */}
      <p aria-live="polite" className="sr-only">
        {readyAgain ? 'Bạn có thể đăng nhập lại.' : ''}
      </p>
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
      <Button type="submit" loading={isSubmitting} disabled={waiting}>
        {isSubmitting
          ? 'Đang đăng nhập…'
          : waiting
            ? `Thử lại sau ${cooldown.remaining} giây`
            : 'Đăng nhập'}
      </Button>
    </ClientForm>
  );
}
