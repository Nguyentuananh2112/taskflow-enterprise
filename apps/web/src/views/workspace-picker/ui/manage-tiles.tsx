'use client';

import Link from 'next/link';

import { useHrPendingLeaveCount } from '@/entities/hr';
import { useCompanyPermission } from '@/entities/session';

const TILE =
  'flex min-h-20 flex-col justify-center gap-1 rounded-card border border-border bg-surface p-4 shadow-card hover:border-primary';

/**
 * Khối "Việc quản lý" ở trang chính (ADR-139 mục 2, E A1): ô LỚN theo quyền công ty — người không rành IT bấm ô to dễ
 * hơn tìm menu. "Bảng lương" thêm ở Mốc 4 (chưa có trang). Không quyền nào ⇒ không có khối.
 */
export function ManageTiles() {
  const { can } = useCompanyPermission();
  const hr = can('hr:manage');
  const admin = can('company:admin');
  const pending = useHrPendingLeaveCount(hr).data;
  if (!hr && !admin) return null;
  const waiting =
    pending && pending.count > 0 ? `${pending.more ? `${pending.count}+` : pending.count}` : null;
  return (
    <section aria-labelledby="manage-heading" className="flex flex-col gap-3">
      <h2 id="manage-heading" className="text-base font-semibold">
        Việc quản lý
      </h2>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {hr && (
          <li>
            <Link href={waiting ? '/hr?tab=leave' : '/hr'} className={TILE}>
              <span className="font-medium">Nhân sự</span>
              {/* Một dòng cố định (không chèn / xóa) ⇒ số đơn về sau không đẩy ô khác. */}
              <span className="text-sm text-text-muted">
                {waiting ? `${waiting} đơn nghỉ chờ duyệt` : 'Chấm công, đơn nghỉ, ngày lễ'}
              </span>
            </Link>
          </li>
        )}
        {admin && (
          <li>
            <Link href="/admin" className={TILE}>
              <span className="font-medium">Quản trị</span>
              <span className="text-sm text-text-muted">
                Phân quyền, workspace, thông tin công ty
              </span>
            </Link>
          </li>
        )}
      </ul>
    </section>
  );
}
