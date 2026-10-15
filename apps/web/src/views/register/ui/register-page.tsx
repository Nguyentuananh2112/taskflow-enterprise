import Link from 'next/link';

import { RegisterForm } from '@/features/auth-register';
import { AuthCard } from '@/shared/ui/auth-card';

/** `/register` (frontend.md §1.2). Đăng ký xong là đã đăng nhập ⇒ GuestGate chuyển vào `/w`. */
export function RegisterPage() {
  return (
    <AuthCard
      title="Tạo tài khoản"
      subtitle="Bắt đầu quản lý công việc cùng nhóm của bạn."
      footer={
        <>
          Đã có tài khoản?{' '}
          <Link href="/login" className="font-medium text-primary underline">
            Đăng nhập
          </Link>
        </>
      }
    >
      <RegisterForm />
    </AuthCard>
  );
}
