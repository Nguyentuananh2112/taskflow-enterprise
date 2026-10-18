'use client';

import Link from 'next/link';

import { useMe } from '@/entities/session';
import { LogoutAllSection } from '@/features/auth-logout';
import { AvatarSection } from '@/features/avatar-upload';
import { ChangePasswordForm } from '@/features/change-password';
import { ProfileForm } from '@/features/profile-edit';
import { ThemeSelect } from '@/features/theme-switch';
import { Button } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/empty-state';
import { Skeleton } from '@/shared/ui/skeleton';
import { PageMain } from '@/shared/ui/page';

const CARD = 'flex flex-col gap-4 rounded-card border border-border bg-surface p-6 shadow-card';

/** `/account` (frontend.md §1.2): hồ sơ (ADR-083), ảnh đại diện (ADR-142), đổi mật khẩu, quyền riêng tư (T-075),
 * đăng xuất mọi thiết bị. */
export function AccountPage() {
  const me = useMe();
  return (
    <PageMain className="max-w-2xl gap-6">
      <h1 className="text-xl font-semibold">Tài khoản</h1>
      <section aria-labelledby="profile-heading" className={CARD}>
        <h2 id="profile-heading" className="text-base font-semibold">
          Hồ sơ
        </h2>
        {me.data && <ProfileForm user={me.data.user} />}
        {/* Lỗi tải (mạng/5xx) ⇒ báo + Thử lại thay vì skeleton mãi (frontend.md §1.2, E3). */}
        {!me.data && me.isError && (
          <EmptyState
            title="Không tải được hồ sơ"
            action={<Button onClick={() => void me.refetch()}>Thử lại</Button>}
          />
        )}
        {!me.data && !me.isError && (
          <div role="status" aria-busy="true" aria-label="Đang tải hồ sơ" className="grid gap-3">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        )}
      </section>
      {me.data && (
        <section aria-labelledby="avatar-heading" className={CARD}>
          <h2 id="avatar-heading" className="text-base font-semibold">
            Ảnh đại diện
          </h2>
          <AvatarSection user={me.data.user} />
        </section>
      )}
      <section aria-labelledby="password-heading" className={CARD}>
        <h2 id="password-heading" className="text-base font-semibold">
          Đổi mật khẩu
        </h2>
        <ChangePasswordForm />
      </section>
      <section aria-labelledby="appearance-heading" className={CARD}>
        <h2 id="appearance-heading" className="text-base font-semibold">
          Giao diện
        </h2>
        <ThemeSelect />
      </section>
      <section aria-labelledby="privacy-heading" className={CARD}>
        <h2 id="privacy-heading" className="text-base font-semibold">
          Quyền riêng tư
        </h2>
        <p className="text-sm text-text-muted">
          Công ty xử lý dữ liệu gì của bạn, lưu bao lâu, và đồng ý cho lý do nghỉ.
        </p>
        <Link href="/privacy" className="self-start text-sm underline">
          Xem thông báo quyền riêng tư
        </Link>
      </section>
      <div className={CARD}>
        <LogoutAllSection />
      </div>
    </PageMain>
  );
}
