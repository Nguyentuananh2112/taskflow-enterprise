'use client';

import Link from 'next/link';

import { useCompanyPermission, useMe } from '@/entities/session';
import { ROLE_LABEL } from '@/entities/workspace';
import { DeletedWorkspaces } from '@/features/workspace-restore';
import { Alert } from '@/shared/ui/alert';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/empty-state';
import { PageMain } from '@/shared/ui/page';
import { Skeleton } from '@/shared/ui/skeleton';
import { AttendanceCard, CheckInPrompt, HomeShortcuts } from '@/widgets/attendance-card';

import { ManageTiles } from './manage-tiles';

const dmy = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;

/**
 * `/w` — TRANG CHÍNH sau đăng nhập (ADR-139, 360 px trước), từ trên xuống: (1) thẻ chấm công gọn (nhân viên; Admin
 * không chấm công), (2) "Việc quản lý" theo quyền công ty, (3) lối tắt Bảng công / Xin nghỉ, (4) "Workspace của bạn"
 * + Tạo workspace, khu "Đã xóa — khôi phục được" (T-034). Mọi khối phụ thuộc `/auth/me` ⇒ chờ MỘT lần rồi dựng cả
 * trang (khối theo quyền không "hiện ra sau" đẩy nội dung — cách đo E2E-HR-14). Lời nhắc chấm công (T-045) ở đây.
 */
export function WorkspacePickerPage() {
  const me = useMe();
  const { company, can } = useCompanyPermission();
  const employee = can('attendance:self');

  if (me.isError) {
    return (
      <PageMain>
        <EmptyState
          title="Không tải được trang chính"
          action={<Button onClick={() => void me.refetch()}>Thử lại</Button>}
        />
      </PageMain>
    );
  }
  if (!me.data || !company) {
    return (
      <PageMain className="gap-6">
        <div role="status" aria-busy="true" aria-label="Đang tải" className="grid gap-6">
          <Skeleton className="h-[19rem] md:h-44" />
          <Skeleton className="h-12" />
          <Skeleton className="h-16" />
        </div>
      </PageMain>
    );
  }
  const memberships = me.data.memberships;
  return (
    <PageMain className="gap-6">
      {/* Tiêu đề trang cho trình đọc màn hình; ở 360 px không tốn một dòng (mỗi khối đã có h2 nhìn thấy). */}
      <h1 className="sr-only">Trang chính</h1>
      {company.status === 'OFFBOARDING' && company.offboardLastDay && (
        <Alert tone="info">
          Bạn làm việc tới hết ngày {dmy(company.offboardLastDay)}. Sau ngày đó tài khoản sẽ không
          đăng nhập được.
        </Alert>
      )}
      <AttendanceCard enabled={employee} />
      <CheckInPrompt enabled={employee} />
      <ManageTiles />
      <HomeShortcuts enabled={employee} />
      <section aria-labelledby="ws-heading" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="ws-heading" className="text-base font-semibold">
            Workspace của bạn
          </h2>
          {can('workspace:create') && (
            <Button asChild variant="secondary" className="ml-auto">
              <Link href="/w/new">Tạo workspace</Link>
            </Button>
          )}
        </div>
        {memberships.length === 0 ? (
          <EmptyState
            title="Bạn chưa ở workspace nào"
            description="Tạo workspace mới, hoặc nhờ trưởng dự án thêm bạn vào workspace của họ."
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {memberships.map((m) => (
              <li key={m.workspaceId}>
                <Link
                  href={`/w/${m.workspaceId}/projects`}
                  className="flex items-center justify-between gap-3 rounded-card border border-border bg-surface p-4 shadow-card hover:border-primary"
                >
                  <span className="font-medium">{m.workspaceName}</span>
                  <Badge>{ROLE_LABEL[m.role]}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <DeletedWorkspaces />
    </PageMain>
  );
}
