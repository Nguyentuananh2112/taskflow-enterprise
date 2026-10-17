import { LoginForm } from '@/features/auth-login';
import { AuthCard } from '@/shared/ui/auth-card';

/** `/login` (frontend.md §1.2). Điều hướng sau đăng nhập do GuestGate lo (`?next=` an toàn). */
export function LoginPage() {
  return (
    <AuthCard
      title="Đăng nhập"
      subtitle="Chào mừng bạn quay lại TaskFlow."
      // ADR-137: không tự đăng ký — tài khoản do bộ phận nhân sự tạo, nhân viên kích hoạt bằng link.
      footer="Chưa có tài khoản? Hãy nhờ bộ phận nhân sự gửi link kích hoạt."
    >
      <LoginForm />
    </AuthCard>
  );
}
