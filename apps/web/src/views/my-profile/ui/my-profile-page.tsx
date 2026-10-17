'use client';

import Link from 'next/link';

import { MISSING_HIRE_DATE, seniorityText, useMyProfile } from '@/entities/company';
import { useCompanyPermission } from '@/entities/session';
import { Button } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/empty-state';
import { PageMain } from '@/shared/ui/page';
import { Skeleton } from '@/shared/ui/skeleton';

const dmy = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

/**
 * `/my-profile` (`profile:self` — ADR-128): hồ sơ nhân sự của chính mình, CHỈ ĐỌC; sai thì báo bộ phận nhân sự.
 * Admin không phải nhân viên ⇒ không có trang này.
 */
export function MyProfilePage() {
  const { company, can } = useCompanyPermission();
  const allowed = can('profile:self');
  const profile = useMyProfile(allowed);

  if (company !== null && !allowed) {
    return (
      <main className="mx-auto max-w-md px-4 py-16">
        <EmptyState
          title="Tài khoản Quản trị không có hồ sơ nhân viên"
          action={
            <Link href="/w" className="text-sm underline">
              Về trang chính
            </Link>
          }
        />
      </main>
    );
  }
  const p = profile.data;
  const rows: ReadonlyArray<[string, string]> = p
    ? [
        [
          'Ngày vào công ty',
          p.hireDate
            ? `${dmy(p.hireDate)}${p.seniority ? ` (${seniorityText(p.seniority)})` : ''}`
            : MISSING_HIRE_DATE,
        ],
        ['Phòng ban', p.department ?? 'Chưa có'],
        ['Chức vụ', p.jobTitle ?? 'Chưa có'],
        ['Số điện thoại công việc', p.workPhone ?? 'Chưa có'],
      ]
    : [];
  return (
    <PageMain className="max-w-xl gap-4">
      <h1 className="text-xl font-semibold">Hồ sơ của tôi</h1>
      {profile.isError ? (
        <EmptyState
          title="Không tải được hồ sơ"
          action={<Button onClick={() => void profile.refetch()}>Thử lại</Button>}
        />
      ) : !p ? (
        <div role="status" aria-busy="true" aria-label="Đang tải hồ sơ" className="grid gap-2">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      ) : (
        <>
          <dl className="divide-y divide-border rounded-card border border-border bg-surface">
            {rows.map(([label, value]) => (
              <div key={label} className="flex flex-col gap-0.5 p-4 sm:flex-row sm:gap-4">
                <dt className="text-sm text-text-muted sm:w-48">{label}</dt>
                <dd className="font-medium">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="text-sm text-text-muted">
            Thông tin sai? Báo bộ phận nhân sự để sửa — bạn không tự sửa được.
          </p>
        </>
      )}
    </PageMain>
  );
}
