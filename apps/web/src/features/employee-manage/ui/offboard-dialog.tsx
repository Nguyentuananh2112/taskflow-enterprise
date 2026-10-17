'use client';

import type { EmployeeDto, OffboardingResponse } from '@taskflow/contracts/company';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { companyKeys, employeesApi } from '@/entities/company';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Dialog } from '@/shared/ui/dialog';
import { Input } from '@/shared/ui/input';
import { Textarea } from '@/shared/ui/textarea';

import { dmy, employeeErrorMessage, shiftDate } from '../lib/messages';

type Props = Readonly<{ employee: EmployeeDto; today: string; onClose: () => void }>;

/**
 * Cho nghỉ việc có lịch (ADR-137): ngày làm cuối ∈ [hôm nay − 31, hôm nay + 90]; hết ngày đó (06:00 hôm sau) người này
 * không đăng nhập được, rời mọi workspace. Xong ⇒ hiện cảnh báo của server (đơn chờ, workspace sẽ mồ côi).
 */
export function OffboardDialog({ employee, today, onClose }: Props) {
  const [lastDay, setLastDay] = useState(today);
  const [reason, setReason] = useState('');
  const [result, setResult] = useState<OffboardingResponse | null>(null);
  const offboard = useMutation({
    mutationFn: () =>
      employeesApi.scheduleOffboarding(employee.userId, {
        lastDay,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      }),
    onSuccess: (r, _v, _r, context) => {
      void context.client.invalidateQueries({ queryKey: companyKeys.employees() });
      setResult(r);
    },
  });
  if (result) {
    const { pendingLeaveCount, soleOwnerWorkspaces } = result.warnings;
    return (
      <Dialog
        open
        onOpenChange={(next) => !next && onClose()}
        title={`Đã lên lịch nghỉ việc cho ${employee.fullName}`}
        description={`Làm việc tới hết ngày ${dmy(lastDay)}.`}
        footer={<Button onClick={onClose}>Đóng</Button>}
      >
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
          {pendingLeaveCount > 0 && (
            <li>{pendingLeaveCount} đơn nghỉ đang chờ duyệt sẽ tự hủy khi nghỉ việc.</li>
          )}
          {soleOwnerWorkspaces.length > 0 && (
            <li>
              Là chủ sở hữu duy nhất của: {soleOwnerWorkspaces.map((w) => w.name).join(', ')} — Quản
              trị viên sẽ cần giao lại.
            </li>
          )}
          {pendingLeaveCount === 0 && soleOwnerWorkspaces.length === 0 && (
            <li>Không có việc nào cần xử lý thêm.</li>
          )}
        </ul>
      </Dialog>
    );
  }
  return (
    <Dialog
      open
      onOpenChange={(next) => !next && onClose()}
      title={`Cho ${employee.fullName} nghỉ việc`}
      description="Sau ngày làm cuối, người này không đăng nhập được và rời mọi workspace. Bảng công cũ vẫn giữ."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button variant="danger" loading={offboard.isPending} onClick={() => offboard.mutate()}>
            Lên lịch nghỉ việc
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {offboard.isError && <Alert>{employeeErrorMessage(offboard.error)}</Alert>}
        <Input
          label="Ngày làm cuối"
          type="date"
          required
          min={shiftDate(today, -31)}
          max={shiftDate(today, 90)}
          value={lastDay}
          onChange={(e) => setLastDay(e.target.value)}
        />
        <Textarea
          label="Lý do (không bắt buộc)"
          maxLength={500}
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
    </Dialog>
  );
}
