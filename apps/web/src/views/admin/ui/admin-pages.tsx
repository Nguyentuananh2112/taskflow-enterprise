'use client';

import Link from 'next/link';

import { useAccessList, useCompanyInfo } from '@/entities/company';
import { useCompanyPermission, useSession } from '@/entities/session';
import { AccessRow } from '@/features/admin-access';
import { CompanyNameForm } from '@/features/company-rename';
import { Button } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/empty-state';

import { AdminFrame, Loading } from './admin-frame';

const TILE =
  'flex min-h-20 flex-col justify-center gap-1 rounded-card border border-border bg-surface p-4 shadow-card hover:border-primary';

/** `/admin` (ADR-139): ba ô lớn — Phân quyền, Workspace, Thông tin công ty. */
export function AdminPage() {
  return (
    <AdminFrame title="Quản trị" back={false}>
      <ul className="grid gap-3 sm:grid-cols-3">
        <li>
          <Link href="/admin/access" className={TILE}>
            <span className="font-medium">Phân quyền</span>
            <span className="text-sm text-text-muted">Quản trị viên, Nhân sự, Kế toán</span>
          </Link>
        </li>
        <li>
          <Link href="/admin/workspaces" className={TILE}>
            <span className="font-medium">Workspace</span>
            <span className="text-sm text-text-muted">Workspace mồ côi cần giao chủ</span>
          </Link>
        </li>
        <li>
          <Link href="/admin/company" className={TILE}>
            <span className="font-medium">Thông tin công ty</span>
            <span className="text-sm text-text-muted">Tên công ty</span>
          </Link>
        </li>
      </ul>
    </AdminFrame>
  );
}

/** `/admin/access` (ADR-134): mỗi người một dòng — vai trò + quyền cấp thêm, lưu theo dòng. */
export function AdminAccessPage() {
  const allowed = useCompanyPermission().can('company:admin');
  const viewerId = useSession().user?.id ?? null;
  const list = useAccessList(allowed);
  return (
    <AdminFrame title="Phân quyền">
      {list.isPending ? (
        <Loading label="Đang tải phân quyền" />
      ) : list.isError ? (
        <EmptyState
          title="Không tải được phân quyền"
          action={<Button onClick={() => void list.refetch()}>Thử lại</Button>}
        />
      ) : (
        <ul aria-label="Phân quyền" className="flex flex-col gap-2">
          {list.data.map((row) => (
            // key theo version ⇒ dữ liệu mới (lưu xong / tải lại vì xung đột) dựng lại bản nháp của dòng.
            <AccessRow key={`${row.userId}:${String(row.version)}`} row={row} viewerId={viewerId} />
          ))}
        </ul>
      )}
    </AdminFrame>
  );
}

/** `/admin/company`: tên công ty. */
export function AdminCompanyPage() {
  const allowed = useCompanyPermission().can('company:admin');
  const info = useCompanyInfo(allowed);
  return (
    <AdminFrame title="Thông tin công ty">
      {info.data ? (
        <CompanyNameForm key={info.data.version} company={info.data} />
      ) : info.isError ? (
        <EmptyState
          title="Không tải được thông tin công ty"
          action={<Button onClick={() => void info.refetch()}>Thử lại</Button>}
        />
      ) : (
        <Loading label="Đang tải" />
      )}
    </AdminFrame>
  );
}
