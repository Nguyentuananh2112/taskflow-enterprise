import Link from 'next/link';

import { LoginForm } from '@/features/auth-login';
import { AuthCard } from '@/shared/ui/auth-card';

/** `/login` (frontend.md §1.2). Điều hướng sau đăng nhập do GuestGate lo (`?next=` an toàn). */
export function LoginPage() {
  return (
    <AuthCard
      title="Đăng nhập"
      subtitle="Chào mừng bạn quay lại TaskFlow."
      footer={
        <>
          Chưa có tài khoản?{' '}
          <Link href="/register" className="font-medium text-primary underline">
            Đăng ký
          </Link>
        </>
      }
    >
      <LoginForm />
    </AuthCard>
  );
}
