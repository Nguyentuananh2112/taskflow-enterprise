'use client';

import { Password } from '@taskflow/contracts/auth';
import type { ActivationInspectResponse } from '@taskflow/contracts/company';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { authApi, session } from '@/entities/session';
import { isApiError } from '@/shared/api';
import { serverErrorMessage } from '@/shared/lib/form-errors';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { ClientForm } from '@/shared/ui/client-form';
import { PasswordInput } from '@/shared/ui/password-input';

type Props = Readonly<{
  token: string;
  account: ActivationInspectResponse;
  /** 400 / 410 khi gửi (link vừa bị thu hồi / dùng ở tab khác) ⇒ trang đổi sang "link không còn hiệu lực". */
  onGone: () => void;
  /** Kích hoạt xong, đã có phiên — trang điều hướng. */
  onDone: () => void;
}>;

/** Câu lỗi mật khẩu từ 422 `details.issues` (PasswordPolicy của server) — gắn vào ô mật khẩu. */
function passwordIssue(error: unknown): string | null {
  if (!isApiError(error) || error.status !== 422) return null;
  const issues = (error.details as { issues?: Array<{ message?: string }> } | null)?.issues;
  return issues?.[0]?.message ?? 'Mật khẩu chưa đạt yêu cầu.';
}

/**
 * Đặt mật khẩu lần đầu (`POST auth/activate` — chỉ bước này tiêu token). Ô username ẩn mang email ⇒ trình quản lý mật
 * khẩu lưu đúng cặp (link hay mở trong trình duyệt của Zalo / Messenger, lần sau người dùng vào Chrome — E B3). Mật
 * khẩu yếu ⇒ 422, token VẪN sống, giữ nguyên trang.
 */
export function ActivateForm({ token, account, onGone, onDone }: Props) {
  const [password, setPassword] = useState('');
  /** Lỗi của ô mật khẩu (độ dài, PasswordPolicy) — tách khỏi lỗi chung (quá nhiều lần thử, mất mạng). */
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const activate = useMutation({
    mutationFn: () => authApi.activate({ token, password }),
    onSuccess: ({ accessToken, expiresIn, user }) => {
      session.signIn({ accessToken, expiresIn }, user);
      onDone();
    },
    onError: (e) => {
      if (isApiError(e, 'ACTIVATION_INVALID') || isApiError(e, 'ACTIVATION_GONE')) onGone();
      else {
        const issue = passwordIssue(e);
        setFieldError(issue);
        setFormError(issue ? null : serverErrorMessage(e));
      }
    },
  });
  const submit = () => {
    setFormError(null);
    if (!Password.safeParse(password).success) {
      setFieldError('Mật khẩu cần từ 12 đến 256 ký tự.');
      return;
    }
    setFieldError(null);
    activate.mutate();
  };
  return (
    <ClientForm
      aria-label="Đặt mật khẩu"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="flex flex-col gap-4"
    >
      <p className="text-sm">
        Tên đăng nhập của bạn: <strong className="break-all">{account.email}</strong>
      </p>
      {/* Cho trình quản lý mật khẩu (không hiển thị, không ai sửa). */}
      <input
        type="text"
        name="username"
        autoComplete="username"
        value={account.email}
        readOnly
        hidden
      />
      {formError && <Alert>{formError}</Alert>}
      <PasswordInput
        label="Mật khẩu mới"
        autoComplete="new-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        error={fieldError ?? undefined}
      />
      <Button type="submit" loading={activate.isPending}>
        Kích hoạt tài khoản
      </Button>
    </ClientForm>
  );
}
