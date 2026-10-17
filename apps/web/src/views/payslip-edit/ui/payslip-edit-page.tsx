'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

import { PayslipSheet, monthLabel, usePayslipForEdit } from '@/entities/payroll';
import { useCompanyPermission, useSession } from '@/entities/session';
import { PayslipForm, RevisePayslip, SavePayslip } from '@/features/payslip-edit';
import { Button } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/empty-state';
import { PageMain } from '@/shared/ui/page';
import { Skeleton } from '@/shared/ui/skeleton';

const PATH = /^\/payroll\/(\d{4}-(?:0[1-9]|1[0-2]))\/([0-9a-f-]{36})$/;

/**
 * `/payroll/YYYY-MM/[userId]` (payroll.md §5.2): NHÁP ⇒ form có ô nhập + "Lưu phiếu"; ĐÃ PHÁT HÀNH ⇒ phiếu chỉ đọc +
 * "Tạo bản điều chỉnh"; phiếu của chính kế toán ⇒ chỉ đọc (luật self tuyệt đối). Form dựng lại theo `lockVersion` /
 * `revision` ⇒ "Tải bản mới" sau 409 hiện bản của người kia.
 */
export function PayslipEditPage() {
  const { company, can } = useCompanyPermission();
  const me = useSession().user?.id ?? null;
  const [, period = '', userId = ''] = PATH.exec(usePathname()) ?? [];
  const q = usePayslipForEdit(period, userId);
  const [revising, setRevising] = useState(false);

  if (company !== null && !can('payroll:manage')) {
    return (
      <main className="mx-auto max-w-md px-4 py-16">
        <EmptyState title="Bạn không có quyền Kế toán" />
      </main>
    );
  }
  const p = q.data;
  const own = userId === me;
  return (
    <PageMain className="max-w-3xl gap-4">
      <Link
        href={`/payroll/${period}`}
        className="self-start text-sm text-text-muted hover:underline"
      >
        ‹ Bảng lương tháng {monthLabel(period)}
      </Link>
      <h1 className="text-xl font-semibold">
        Phiếu lương {p ? `— ${p.fullName}` : ''} · tháng {monthLabel(period)}
      </h1>
      {q.isError ? (
        <EmptyState
          title="Không tải được phiếu"
          action={<Button onClick={() => void q.refetch()}>Thử lại</Button>}
        />
      ) : !p ? (
        <div role="status" aria-busy="true" aria-label="Đang tải phiếu" className="grid gap-2">
          <Skeleton className="h-24" />
          <Skeleton className="h-64" />
        </div>
      ) : own ? (
        <>
          <p className="text-sm text-text-muted">Phiếu của bạn — Kế toán khác hoặc Admin sửa.</p>
          <PayslipSheet payslip={p} />
        </>
      ) : p.status === 'DRAFT' ? (
        <PayslipForm
          key={p.lockVersion}
          payslip={p}
          actions={(check, dirty) => (
            <SavePayslip
              payslip={p}
              check={check}
              dirty={dirty}
              onReload={() => void q.refetch()}
            />
          )}
        />
      ) : revising ? (
        <PayslipForm
          key={`rev-${p.revision}`}
          payslip={p}
          actions={(check, dirty) => (
            <RevisePayslip
              payslip={p}
              check={check}
              dirty={dirty}
              onDone={() => setRevising(false)}
            />
          )}
        />
      ) : (
        <>
          {p.revision > 1 && (
            <p className="text-sm text-text-muted">Bản {p.revision} (đã điều chỉnh).</p>
          )}
          <PayslipSheet payslip={p} />
          <Button className="self-start" onClick={() => setRevising(true)}>
            Tạo bản điều chỉnh
          </Button>
        </>
      )}
    </PageMain>
  );
}
