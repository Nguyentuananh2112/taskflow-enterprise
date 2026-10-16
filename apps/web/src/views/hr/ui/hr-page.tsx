'use client';

import { Uuid } from '@taskflow/contracts/common';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';

import { useCompanyToday } from '@/entities/hr';
import { usePermission } from '@/entities/workspace';
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
 * `/w/[wsId]/hr` (attendance-leave.md §6): Hôm nay · Bảng công tháng · Đơn nghỉ · Lịch & ngày lễ · Số
 * phép. Ẩn khi thiếu `hr:manage` (role ∪ grants — đổi realtime qua `member:grants-changed`); server vẫn
 * kiểm mọi request. Tab theo `?tab=` để chuông "đơn mới" mở thẳng tab Đơn nghỉ. "Hôm nay" (ngày, tháng,
 * năm mặc định) lấy theo server + múi giờ của lịch, không theo máy.
 */
export function HrPage() {
  const { wsId = '' } = useParams<{ wsId: string }>();
  const valid = Uuid.safeParse(wsId).success;
  const { role, can, viewerId } = usePermission(wsId);
  const allowed = valid && can('hr:manage');
  const today = useCompanyToday(wsId, allowed);
  const router = useRouter();
  const pathname = usePathname();
  const tab = useSearchParams().get('tab') ?? 'today';

  if (!valid || isApiError(today.error, 'RESOURCE_NOT_FOUND')) {
    return (
      <main className="mx-auto max-w-md px-4 py-16">
        <EmptyState title="Không tìm thấy hoặc bạn không có quyền truy cập" />
      </main>
    );
  }
  if ((role !== null && !allowed) || isApiError(today.error, 'FORBIDDEN_ACCESS')) {
    return (
      <main className="mx-auto max-w-md px-4 py-16">
        <EmptyState
          title="Bạn không có quyền Quản lý nhân sự"
          description="Chủ sở hữu workspace có thể cấp quyền này trong Cài đặt › Thành viên."
        />
      </main>
    );
  }
  const data = today.data;
  const ctx = { wsId, today: data?.date ?? '', isOwner: role === 'OWNER', viewerId };
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
