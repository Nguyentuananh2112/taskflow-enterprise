'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { useCompanyToday, useForgetHrWhenRevoked } from '@/entities/hr';
import { useCompanyPermission, useSession } from '@/entities/session';
import { isApiError } from '@/shared/api';
import { Button } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/empty-state';
import { PageMain } from '@/shared/ui/page';
import { Skeleton } from '@/shared/ui/skeleton';
import { HrBalances } from '@/widgets/hr-balances';
import { HrCalendar } from '@/widgets/hr-calendar';
import { HrLeaveQueue } from '@/widgets/hr-leave-queue';
import { HrTimesheet } from '@/widgets/hr-timesheet';
import { HrToday } from '@/widgets/hr-today';

import { HrTabs, type HrTab } from './hr-tabs';

/**
 * `/hr` — cấp CÔNG TY (ADR-139; attendance-leave.md §6): Hôm nay · Bảng công tháng · Đơn nghỉ · Lịch & ngày lễ · Số
 * phép. Ẩn khi thiếu `hr:manage` (Admin ngầm có; HR do Admin cấp ở Quản trị — `/auth/me`); server vẫn
 * kiểm mọi request. Tab theo `?tab=` để chuông "đơn mới" mở thẳng tab Đơn nghỉ. "Hôm nay" (ngày, tháng,
 * năm mặc định) lấy theo server + múi giờ của lịch, không theo máy.
 */
export function HrPage() {
  const { company, can } = useCompanyPermission();
  const viewerId = useSession().user?.id ?? null;
  const allowed = can('hr:manage');
  const today = useCompanyToday(allowed);
  useForgetHrWhenRevoked(company !== null && !allowed);
  const router = useRouter();
  const pathname = usePathname();
  const tab = useSearchParams().get('tab') ?? 'today';

  // Mất quyền khi đang mở trang (realtime / 403) ⇒ báo rõ + lối về, không màn trắng (E A5).
  if ((company !== null && !allowed) || isApiError(today.error, 'FORBIDDEN_ACCESS')) {
    return (
      <main className="mx-auto max-w-md px-4 py-16">
        <EmptyState
          title="Bạn không có quyền Quản lý nhân sự"
          description="Quản trị viên công ty cấp quyền này ở mục Quản trị › Phân quyền."
          action={
            <Link href="/w" className="text-sm underline">
              Về trang chính
            </Link>
          }
        />
      </main>
    );
  }
  const data = today.data;
  const ctx = { today: data?.date ?? '', isAdmin: company?.role === 'ADMIN', viewerId };
  const tabs: HrTab[] = [
    { key: 'today', label: 'Hôm nay', render: () => data && <HrToday data={data} /> },
    { key: 'timesheet', label: 'Bảng công tháng', render: () => <HrTimesheet {...ctx} /> },
    { key: 'leave', label: 'Đơn nghỉ', render: () => <HrLeaveQueue {...ctx} /> },
    { key: 'calendar', label: 'Lịch & ngày lễ', render: () => <HrCalendar {...ctx} /> },
    { key: 'balances', label: 'Số phép', render: () => <HrBalances {...ctx} /> },
  ];
  return (
    <PageMain className="max-w-5xl gap-4">
      <h1 className="text-xl font-semibold">Nhân sự</h1>
      {data ? (
        <HrTabs
          tabs={tabs}
          current={tab}
          onChange={(key) => router.replace(`${pathname}?tab=${key}`)}
        />
      ) : today.isError ? (
        <EmptyState
          title="Không tải được dữ liệu nhân sự"
          action={<Button onClick={() => void today.refetch()}>Thử lại</Button>}
        />
      ) : (
        <div role="status" aria-busy="true" aria-label="Đang tải" className="flex flex-col gap-2">
          <Skeleton className="h-10" />
          <Skeleton className="h-48" />
        </div>
      )}
    </PageMain>
  );
}
