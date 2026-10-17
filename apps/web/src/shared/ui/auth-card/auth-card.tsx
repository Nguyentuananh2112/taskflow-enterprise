import type { ReactNode } from 'react';

type Props = Readonly<{
  title: string;
  subtitle?: string;
  footer?: ReactNode;
  children: ReactNode;
}>;

/** Khung chung của màn khách (đăng nhập, kích hoạt tài khoản): một `main`, một `h1`. */
export function AuthCard({ title, subtitle, footer, children }: Props) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <section
        aria-labelledby="auth-heading"
        className="flex w-full max-w-sm flex-col gap-6 rounded-card border border-border bg-surface p-6 shadow-card"
      >
        <div className="flex flex-col gap-1">
          <h1 id="auth-heading" className="text-xl font-semibold">
            {title}
          </h1>
          {subtitle && <p className="text-sm text-text-muted">{subtitle}</p>}
        </div>
        {children}
        {footer && <p className="text-sm text-text-muted">{footer}</p>}
      </section>
    </main>
  );
}
