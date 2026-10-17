'use client';

import type { ActivationDto, EmployeeDto } from '@taskflow/contracts/company';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { companyKeys, employeesApi } from '@/entities/company';
import { Button } from '@/shared/ui/button';
import { toast } from '@/shared/ui/toast';

import { employeeErrorMessage } from '../lib/messages';
import { HireDialog } from './hire-dialog';
import { LinkBox } from './link-box';
import { OffboardDialog } from './offboard-dialog';

type Props = Readonly<{
  employee: EmployeeDto;
  today: string;
  /**
   * HR không tác động chính mình / người giữ quyền Nhân sự, Kế toán (ADR-137 — Admin làm). Khóa ⇒ không nút, có câu
   * giải thích (server vẫn 403).
   */
  locked: boolean;
}>;

/**
 * MỘT nút chính theo trạng thái (người không rành IT không phải chọn trong menu): chờ kích hoạt ⇒ Tạo lại link · đang
 * làm ⇒ Cho nghỉ việc · sắp nghỉ ⇒ Hủy lịch nghỉ · đã nghỉ ⇒ Nhận lại.
 */
export function EmployeeActions({ employee, today, locked }: Props) {
  const [dialog, setDialog] = useState<'offboard' | 'rehire' | null>(null);
  const [link, setLink] = useState<ActivationDto | null>(null);
  const onError = (error: unknown) => toast({ title: employeeErrorMessage(error), tone: 'error' });
  const reissue = useMutation({
    mutationFn: () => employeesApi.reissueLink(employee.userId),
    onSuccess: (r) => setLink(r.activation),
    onError,
  });
  const cancel = useMutation({
    mutationFn: () => employeesApi.cancelOffboarding(employee.userId),
    onSuccess: (_r, _v, _c, context) => {
      void context.client.invalidateQueries({ queryKey: companyKeys.employees() });
      toast({ title: `Đã hủy lịch nghỉ việc của ${employee.fullName}`, tone: 'success' });
    },
    onError,
  });

  if (locked && employee.status !== 'LEFT') {
    return <p className="text-xs text-text-muted">Quản trị viên xử lý</p>;
  }
  const name = employee.fullName;
  return (
    <>
      {employee.status === 'PENDING_ACTIVATION' && (
        <Button
          size="sm"
          variant="secondary"
          loading={reissue.isPending}
          aria-label={`Tạo lại link cho ${name}`}
          onClick={() => reissue.mutate()}
        >
          Tạo lại link
        </Button>
      )}
      {employee.status === 'ACTIVE' && (
        <Button
          size="sm"
          variant="secondary"
          aria-label={`Cho ${name} nghỉ việc`}
          onClick={() => setDialog('offboard')}
        >
          Cho nghỉ việc
        </Button>
      )}
      {employee.status === 'OFFBOARDING' && (
        <Button
          size="sm"
          variant="secondary"
          loading={cancel.isPending}
          aria-label={`Hủy lịch nghỉ việc của ${name}`}
          onClick={() => cancel.mutate()}
        >
          Hủy lịch nghỉ
        </Button>
      )}
      {employee.status === 'LEFT' && (
        <Button
          size="sm"
          variant="secondary"
          aria-label={`Nhận lại ${name}`}
          onClick={() => setDialog('rehire')}
        >
          Nhận lại
        </Button>
      )}
      {dialog === 'offboard' && (
        <OffboardDialog employee={employee} today={today} onClose={() => setDialog(null)} />
      )}
      {dialog === 'rehire' && (
        <HireDialog
          today={today}
          rehire={{ email: employee.email, fullName: employee.fullName }}
          onClose={() => setDialog(null)}
        />
      )}
      {link && <LinkBox fullName={name} activation={link} onClose={() => setLink(null)} />}
    </>
  );
}
