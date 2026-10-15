import type { ReactNode } from 'react';

import { cn } from '@/shared/lib/cn';

type Props = Readonly<{
  title: string;
  description?: string;
  /** Icon trang trí. */
  icon?: ReactNode;
  /** Hành động chính, vd nút "Tạo dự án" — chỉ truyền khi người dùng có quyền (frontend.md §5). */
  action?: ReactNode;
  /** Cấp heading phù hợp vị trí trong trang (mặc định h2). */
  headingLevel?: 2 | 3;
  className?: string;
}>;

export function EmptyState({
  title,
  description,
  icon,
  action,
  headingLevel = 2,
  className,
}: Props) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <section
      className={cn(
        'flex flex-col items-center gap-2 rounded-card border border-dashed border-border px-6 py-10 text-center',
        className,
      )}
    >
      {icon && (
        <span aria-hidden="true" className="text-text-muted">
          {icon}
        </span>
      )}
      <Heading className="text-base font-semibold text-text">{title}</Heading>
      {description && <p className="max-w-prose text-sm text-text-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </section>
  );
}
