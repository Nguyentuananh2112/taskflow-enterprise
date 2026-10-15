'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { RegisterBody } from '@taskflow/contracts/auth';
import { useForm } from 'react-hook-form';

import { applyServerErrors } from '@/shared/lib/form-errors';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';

import { useRegister } from '../model/use-register';

const FIELDS = ['fullName', 'email', 'password'] as const;
/** frontend.md §1.2: trùng email ⇒ lỗi tại trường email. */
const FIELD_BY_CODE = { EMAIL_ALREADY_EXISTS: 'email' } as const;

/** Form đăng ký — luật lấy thẳng từ `RegisterBody` (mật khẩu 12–256 ký tự, ADR-049/065). */
export function RegisterForm() {
  const signUp = useRegister();
  const { register, handleSubmit, setError, formState } = useForm({
    resolver: zodResolver(RegisterBody),
  });
  const { errors, isSubmitting } = formState;

  const onSubmit = handleSubmit(async (values) => {
    try {
      await signUp.mutateAsync(values);
    } catch (error) {
      // Mật khẩu phổ biến / chứa email chỉ server biết ⇒ về qua VALIDATION_ERROR.issues (§7.2).
      applyServerErrors((name, e) => setError(name as (typeof FIELDS)[number], e), error, {
        fields: FIELDS,
        fieldByCode: FIELD_BY_CODE,
      });
    }
  });

  return (
    <form noValidate onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-4">
      {errors.root?.server && <Alert>{errors.root.server.message}</Alert>}
      <Input
        label="Họ tên"
        autoComplete="name"
        required
        error={errors.fullName?.message}
        {...register('fullName')}
      />
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
        autoComplete="new-password"
        hint="Từ 12 đến 256 ký tự. Nên dùng một cụm từ dễ nhớ."
        required
        error={errors.password?.message}
        {...register('password')}
      />
      <Button type="submit" loading={isSubmitting}>
        {isSubmitting ? 'Đang tạo tài khoản…' : 'Tạo tài khoản'}
      </Button>
    </form>
  );
}
