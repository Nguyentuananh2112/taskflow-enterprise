'use client';

import { Uuid } from '@taskflow/contracts/common';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';

import { usePermission } from '@/entities/workspace';

/**
 * Lối vào "Nhân sự" trên header ở mọi route có `wsId` — hiện NGAY khi được cấp `hr:manage` (myGrants đổi
 * realtime qua `member:grants-changed` — E2E-HR-03), ẩn ngay khi bị thu. Màn hẹp (360) không đủ chỗ ⇒
 * ẩn; ở đó thẻ Chấm công đầu trang dự án vẫn có link.
 */
export function HeaderHr() {
  const { wsId } = useParams<{ wsId?: string }>();
  const id = wsId && Uuid.safeParse(wsId).success ? wsId : '';
  const { can } = usePermission(id);
  const href = `/w/${id}/hr`;
  const current = usePathname() === href;
  if (id === '' || !can('hr:manage')) return null;
  return (
    <Link
      href={href}
      aria-current={current ? 'page' : undefined}
      className="hidden rounded-control px-3 py-1.5 text-sm whitespace-nowrap text-text hover:bg-bg-subtle aria-[current=page]:font-medium sm:inline-flex"
    >
      Nhân sự
    </Link>
  );
}
