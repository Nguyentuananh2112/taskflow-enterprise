'use client';

import Link from 'next/link';

import { usePayrollSettings, useSalaryProfiles } from '@/entities/payroll';
import { useCompanyPermission, useSession } from '@/entities/session';
import { AddVersionDialog, SenioritySetting } from '@/features/salary-profile-edit';
import { formatVnd } from '@/shared/lib/money';
import { Button } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/empty-state';
import { PageMain } from '@/shared/ui/page';
import { Skeleton } from '@/shared/ui/skeleton';

const dmy = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const my = (p: string) => `${p.slice(5, 7)}/${p.slice(0, 4)}`;

/**
 * `/payroll/profiles` (payroll.md §5.2): hồ sơ lương theo phiên bản (lịch sử xem được), "Ngày vào công ty" CHỈ ĐỌC (HR
 * sửa ở Nhân sự → Nhân viên), mức thâm niên / năm của công ty. Hồ sơ của chính kế toán chỉ đọc (luật self).
 */
export function PayrollProfilesPage() {
  const { company, can } = useCompanyPermission();
  const allowed = can('payroll:manage');
  const me = useSession().user?.id ?? null;
  const profiles = useSalaryProfiles(allowed);
  const settings = usePayrollSettings(allowed).data;
  // Chỉ là giá trị gợi ý của ô "Áp dụng từ tháng" (người dùng đổi được) — server kiểm.
  const thisMonth = new Date().toISOString().slice(0, 7);

  if (company !== null && !allowed) {
    return (
      <main className="mx-auto max-w-md px-4 py-16">
        <EmptyState title="Bạn không có quyền Kế toán" />
      </main>
    );
  }
  return (
    <PageMain className="max-w-4xl gap-4">
      <Link href="/payroll" className="self-start text-sm text-text-muted hover:underline">
        ‹ Bảng lương
      </Link>
      <h1 className="text-xl font-semibold">Hồ sơ lương</h1>
      {settings && <SenioritySetting key={settings.version} settings={settings} />}
      {profiles.isError ? (
        <EmptyState
          title="Không tải được hồ sơ lương"
          action={<Button onClick={() => void profiles.refetch()}>Thử lại</Button>}
        />
      ) : !profiles.data ? (
        <div
          role="status"
          aria-busy="true"
          aria-label="Đang tải hồ sơ lương"
          className="grid gap-2"
        >
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : (
        <ul aria-label="Hồ sơ lương nhân viên" className="flex flex-col gap-2">
          {profiles.data.map((r) => (
            <li
              key={r.userId}
              aria-label={r.user.fullName}
              className="flex flex-col gap-2 rounded-card border border-border bg-surface p-4"
            >
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="font-medium">{r.user.fullName}</span>
                <span className="text-sm">
                  {r.current
                    ? `${r.current.level} · ${formatVnd(r.current.baseSalary)} (từ ${my(r.current.effectiveFrom)})`
                    : 'Chưa có hồ sơ lương'}
                </span>
                <span className="ml-auto">
                  {r.userId === me ? (
                    <span className="text-xs text-text-muted">Kế toán khác hoặc Admin sửa</span>
                  ) : (
                    <AddVersionDialog row={r} thisMonth={thisMonth} />
                  )}
                </span>
              </div>
              <p className="text-sm text-text-muted">
                Ngày vào công ty: {r.hireDate ? dmy(r.hireDate) : 'chưa có'} — HR sửa ở Nhân sự →
                Nhân viên
              </p>
              {r.versions.length > 1 && (
                <details className="text-sm">
                  <summary className="cursor-pointer">
                    Lịch sử ({r.versions.length} phiên bản)
                  </summary>
                  <ul className="mt-1 flex flex-col gap-0.5 pl-4">
                    {r.versions.map((v) => (
                      <li key={v.id} className="tabular-nums">
                        Từ {my(v.effectiveFrom)}: {v.level} · {formatVnd(v.baseSalary)} —{' '}
                        {v.createdBy.fullName}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
    </PageMain>
  );
}
