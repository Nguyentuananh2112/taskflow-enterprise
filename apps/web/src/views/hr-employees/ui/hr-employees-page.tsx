'use client';

import type { EmployeeDto, ListEmployeesQuery } from '@taskflow/contracts/company';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { useEmployees } from '@/entities/company';
import { useCompanyToday } from '@/entities/hr';
import { useCompanyPermission, useSession } from '@/entities/session';
import { RemoveAvatarDialog } from '@/features/avatar-remove';
import { HireDialog, OffboardDialog } from '@/features/employee-manage';
import { cn } from '@/shared/lib/cn';
import { useDebouncedValue } from '@/shared/lib/use-debounced-value';
import { Button } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/empty-state';
import { Input } from '@/shared/ui/input';
import { PageMain } from '@/shared/ui/page';
import { Skeleton } from '@/shared/ui/skeleton';

import { EmployeeRow } from './employee-row';

type Status = NonNullable<ListEmployeesQuery['status']>;

const TABS: ReadonlyArray<{ value: Status | null; label: string }> = [
  { value: null, label: 'Hiện tại' },
  { value: 'pending', label: 'Chờ kích hoạt' },
  { value: 'offboarding', label: 'Sắp nghỉ' },
  { value: 'left', label: 'Đã nghỉ' },
];
const STATUSES = new Set<string>(['active', 'pending', 'offboarding', 'left']);

/**
 * `/hr/employees` (ADR-137, ADR-139; `hr:manage`) — danh sách nhân viên theo trạng thái (`?status=`), tìm theo tên /
 * email (≥ 2 ký tự), "Thêm nhân viên" + hộp link MỘT lần, mỗi dòng MỘT nút theo trạng thái. 360 px: thẻ xếp dọc.
 */
export function HrEmployeesPage() {
  const { company, can } = useCompanyPermission();
  const viewerId = useSession().user?.id ?? null;
  const allowed = can('hr:manage');
  const isAdmin = company?.role === 'ADMIN';
  const asked = useSearchParams().get('status');
  const status = asked && STATUSES.has(asked) ? (asked as Status) : undefined;
  const [search, setSearch] = useState('');
  const term = useDebouncedValue(search.trim(), 300);
  const q = term.length >= 2 ? term : undefined;
  const list = useEmployees({ status, q }, allowed);
  const today = useCompanyToday(allowed).data?.date ?? null;
  // Hộp thoại ở CẤP TRANG (không trong dòng) ⇒ người đổi trạng thái rời bộ lọc vẫn thấy kết quả (F, E2E-HR-19).
  const [dialog, setDialog] = useState<
    { kind: 'hire' } | { kind: 'offboard' | 'rehire' | 'avatar'; employee: EmployeeDto } | null
  >(null);
  const close = () => setDialog(null);

  if (company !== null && !allowed) {
    return (
      <main className="mx-auto max-w-md px-4 py-16">
        <EmptyState
          title="Bạn không có quyền Quản lý nhân sự"
          action={
            <Link href="/w" className="text-sm underline">
              Về trang chính
            </Link>
          }
        />
      </main>
    );
  }
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <PageMain className="max-w-4xl gap-4">
      <Link href="/hr" className="self-start text-sm text-text-muted hover:underline">
        ‹ Nhân sự
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Nhân viên</h1>
        <Button className="ml-auto" disabled={!today} onClick={() => setDialog({ kind: 'hire' })}>
          Thêm nhân viên
        </Button>
      </div>
      <nav aria-label="Lọc theo trạng thái" className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Link
            key={t.label}
            href={t.value ? `/hr/employees?status=${t.value}` : '/hr/employees'}
            aria-current={(t.value ?? undefined) === status ? 'page' : undefined}
            className={cn(
              'rounded-control px-3 py-1.5 text-sm',
              (t.value ?? undefined) === status
                ? 'bg-primary text-primary-fg'
                : 'hover:bg-bg-subtle',
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <Input
        label="Tìm theo tên hoặc email"
        type="search"
        autoComplete="off"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        hint={search.trim().length === 1 ? 'Gõ ít nhất 2 ký tự.' : undefined}
      />
      {list.isPending ? (
        <div role="status" aria-busy="true" aria-label="Đang tải nhân viên" className="grid gap-2">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : list.isError ? (
        <EmptyState
          title="Không tải được danh sách nhân viên"
          action={<Button onClick={() => void list.refetch()}>Thử lại</Button>}
        />
      ) : rows.length === 0 ? (
        <EmptyState title={q ? 'Không tìm thấy ai' : 'Chưa có nhân viên nào ở mục này'} />
      ) : (
        <ul aria-label="Danh sách nhân viên" className="flex flex-col gap-2">
          {rows.map((e) => (
            <EmployeeRow
              key={e.userId}
              employee={e}
              ready={today !== null}
              self={e.userId === viewerId}
              onOpen={(kind, employee) => setDialog({ kind, employee })}
              onRemoveAvatar={(employee) => setDialog({ kind: 'avatar', employee })}
              locked={!isAdmin && (e.userId === viewerId || e.grants.length > 0)}
            />
          ))}
        </ul>
      )}
      {list.hasNextPage && (
        <Button
          variant="secondary"
          className="self-center"
          loading={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          Tải thêm
        </Button>
      )}
      {dialog?.kind === 'avatar' && (
        <RemoveAvatarDialog employee={dialog.employee} onClose={close} />
      )}
      {today && dialog?.kind === 'hire' && <HireDialog today={today} onClose={close} />}
      {today && dialog?.kind === 'offboard' && (
        <OffboardDialog employee={dialog.employee} today={today} onClose={close} />
      )}
      {today && dialog?.kind === 'rehire' && (
        <HireDialog
          today={today}
          rehire={{ email: dialog.employee.email, fullName: dialog.employee.fullName }}
          onClose={close}
        />
      )}
    </PageMain>
  );
}
