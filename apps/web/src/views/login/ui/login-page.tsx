'use client';

import type { FormEvent } from 'react';

import { Button } from '@/shared/ui/button';
import { Dialog, DialogClose } from '@/shared/ui/dialog';
import { Input } from '@/shared/ui/input';
import { toast } from '@/shared/ui/toast';

/**
 * Placeholder `/login` (T-012): chứng minh pipeline shared/ui (Input, Button, Dialog, Toast).
 * Form thật (react-hook-form + LoginBody từ contracts, gọi /auth/login) làm ở Phase 4 — features/auth-login.
 */
export function LoginPage() {
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    toast({ title: 'Chưa hỗ trợ', description: 'Đăng nhập sẽ có ở bản tiếp theo.' });
  };

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <section
        aria-labelledby="login-heading"
        className="flex w-full max-w-sm flex-col gap-6 rounded-card border border-border bg-surface p-6 shadow-card"
      >
        <div className="flex flex-col gap-1">
          <h1 id="login-heading" className="text-xl font-semibold">
            Đăng nhập
          </h1>
          <p className="text-sm text-text-muted">Chào mừng bạn quay lại TaskFlow.</p>
        </div>
        <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          <Input label="Email" name="email" type="email" autoComplete="email" required />
          <Input
            label="Mật khẩu"
            name="password"
            type="password"
            autoComplete="current-password"
            // ADR-049/065: 12–256 ký tự (luật đầy đủ lấy từ contracts ở Phase 4).
            minLength={12}
            maxLength={256}
            required
          />
          <Button type="submit">Đăng nhập</Button>
        </form>
        <Dialog
          title="Quên mật khẩu?"
          description="Tính năng đặt lại mật khẩu qua email chưa có ở phiên bản này."
          trigger={
            <Button variant="ghost" size="sm" className="self-start">
              Quên mật khẩu?
            </Button>
          }
          footer={
            <DialogClose>
              <Button variant="secondary">Đã hiểu</Button>
            </DialogClose>
          }
        >
          <p className="text-sm">
            Vui lòng liên hệ quản trị viên workspace của bạn để được hỗ trợ.
          </p>
        </Dialog>
      </section>
    </main>
  );
}
