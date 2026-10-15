'use client';

import type { FormEvent, ReactNode } from 'react';

import { useHydrated } from '@/shared/lib/use-hydrated';

type Props = Readonly<{
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  className?: string;
  'aria-label'?: string;
  children: ReactNode;
}>;

/**
 * Form chỉ gửi được bằng JS (T-029 Medium): trước khi hydrate, mọi ô bị khóa (`fieldset disabled`)
 * ⇒ bấm Enter không thể kích hoạt submit gốc của trình duyệt — mặc định là GET, sẽ đưa mật khẩu lên
 * URL (lịch sử, log proxy, Referer). `method="post"` là lớp phòng thủ thứ hai.
 */
export function ClientForm({ onSubmit, className, children, ...rest }: Props) {
  const hydrated = useHydrated();
  return (
    <form method="post" noValidate onSubmit={onSubmit} className={className} {...rest}>
      <fieldset disabled={!hydrated} className="contents">
        {children}
      </fieldset>
    </form>
  );
}
