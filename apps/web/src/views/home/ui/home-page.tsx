import Link from 'next/link';

import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';

const FEATURES = [
  {
    title: 'Bảng Kanban thời gian thực',
    text: 'Kéo thả task, đồng đội thấy thay đổi ngay lập tức.',
  },
  { title: 'Phân quyền theo vai trò', text: 'Chủ sở hữu, Quản lý dự án, Thành viên, Người xem.' },
  { title: 'Lịch sử đầy đủ', text: 'Mọi thay đổi trạng thái và người phụ trách đều được ghi lại.' },
] as const;

/** Landing (route `/`, render server — frontend.md §1.1). Placeholder chứng minh pipeline shared/ui. */
export function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-8 px-6 py-16">
      <header className="flex flex-col gap-3">
        <Badge tone="primary">Bản xem trước</Badge>
        <h1 className="text-xl font-semibold tracking-tight">TaskFlow</h1>
        <p className="max-w-prose text-base text-text-muted">
          Quản lý công việc theo nhóm với bảng Kanban thời gian thực.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button asChild>
            <Link href="/login">Đăng nhập</Link>
          </Button>
        </div>
      </header>
      <section aria-labelledby="features-heading" className="flex flex-col gap-3">
        <h2 id="features-heading" className="text-base font-semibold">
          Tính năng chính
        </h2>
        <ul className="grid gap-3 sm:grid-cols-3">
          {FEATURES.map((f) => (
            <li
              key={f.title}
              className="rounded-card border border-border bg-surface p-4 shadow-card"
            >
              <h3 className="text-sm font-semibold">{f.title}</h3>
              <p className="mt-1 text-sm text-text-muted">{f.text}</p>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
