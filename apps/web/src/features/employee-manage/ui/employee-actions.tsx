'use client';

import type { ActivationDto, EmployeeDto } from '@taskflow/contracts/company';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { companyKeys, employeesApi } from '@/entities/company';
import { Button } from '@/shared/ui/button';
import { toast } from '@/shared/ui/toast';

import { employeeErrorMessage } from '../lib/messages';
import { LinkBox } from './link-box';

type Props = Readonly<{
  employee: EmployeeDto;
  /**
   * HR không tác động chính mình / người giữ quyền Nhân sự, Kế toán (ADR-137 — Admin làm). Khóa ⇒ không nút, có câu
   * giải thích (server vẫn 403).
   */
  locked: boolean;
  /**
   * Mở hộp "Cho nghỉ việc" / "Nhận lại" ở CẤP TRANG — hộp KHÔNG nằm trong dòng: xong việc người này đổi trạng thái, rời
   * bộ lọc đang xem và dòng bị gỡ khi danh sách tải lại (F, E2E-HR-19).
   */
  onOpen: (kind: 'offboard' | 'rehire', employee: EmployeeDto) => void;
}>;

/**
 * MỘT nút chính theo trạng thái (người không rành IT không phải chọn trong menu): chờ kích hoạt ⇒ Tạo lại link · đang
 * làm ⇒ Cho nghỉ việc · sắp nghỉ ⇒ Hủy lịch nghỉ · đã nghỉ ⇒ Nhận lại.
 */
export function EmployeeActions({ employee, locked, onOpen }: Props) {
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
          onClick={() => onOpen('offboard', employee)}
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
          onClick={() => onOpen('rehire', employee)}
        >
          Nhận lại
        </Button>
      )}
      {link && <LinkBox fullName={name} activation={link} onClose={() => setLink(null)} />}
    </>
  );
}
