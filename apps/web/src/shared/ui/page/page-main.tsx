import type { ReactNode } from 'react';

import { cn } from '@/shared/lib/cn';

/**
 * Khung ngang DUY NHẤT của khu đã đăng nhập: header và mọi màn dùng chung ⇒ cùng mép trái/phải ở mọi
 * viewport (logo "TaskFlow" thẳng cột với tiêu đề màn và cột đầu tiên của board).
 */
export const PAGE_CONTAINER = 'mx-auto w-full max-w-7xl px-4 sm:px-6';

type Props = Readonly<{
  children: ReactNode;
  /** Class của khối nội dung (gap, giới hạn bề ngang cho form…). Khối căn TRÁI trong khung, không căn giữa. */
  className?: string;
}>;

/** `<main>` của một màn trong khu đã đăng nhập, đặt trong {@link PAGE_CONTAINER}. */
export function PageMain({ children, className }: Props) {
  return (
    <main className={cn(PAGE_CONTAINER, 'py-8')}>
      <div className={cn('flex flex-col', className)}>{children}</div>
    </main>
  );
}
