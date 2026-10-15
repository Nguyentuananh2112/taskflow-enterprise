'use client';

import { useMe } from '@/entities/session';
import { LogoutAllSection } from '@/features/auth-logout';
import { ChangePasswordForm } from '@/features/change-password';
import { ProfileForm } from '@/features/profile-edit';
import { Skeleton } from '@/shared/ui/skeleton';

const CARD = 'flex flex-col gap-4 rounded-card border border-border bg-surface p-6 shadow-card';

/** `/account` (frontend.md §1.2): hồ sơ (ADR-083), đổi mật khẩu, đăng xuất mọi thiết bị. */
export function AccountPage() {
  const me = useMe();
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <h1 className="text-xl font-semibold">Tài khoản</h1>
      <section aria-labelledby="profile-heading" className={CARD}>
        <h2 id="profile-heading" className="text-base font-semibold">
          Hồ sơ
        </h2>
        {me.data ? (
          <ProfileForm user={me.data.user} />
        ) : (
          <div role="status" aria-busy="true" aria-label="Đang tải hồ sơ" className="grid gap-3">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        )}
      </section>
      <section aria-labelledby="password-heading" className={CARD}>
        <h2 id="password-heading" className="text-base font-semibold">
          Đổi mật khẩu
        </h2>
        <ChangePasswordForm />
      </section>
      <div className={CARD}>
        <LogoutAllSection />
      </div>
    </main>
  );
}
