'use client';

import type { PayslipDto } from '@taskflow/contracts/payroll';
import { useMutation } from '@tanstack/react-query';

import { payrollApi, payrollKeys } from '@/entities/payroll';
import { isApiError } from '@/shared/api';
import { serverErrorMessage } from '@/shared/lib/form-errors';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { toast } from '@/shared/ui/toast';

import type { FormCheck } from '../lib/form-state';

type Props = Readonly<{
  payslip: PayslipDto;
  check: FormCheck;
  dirty: boolean;
  onReload: () => void;
}>;

/** Lưu phiếu NHÁP (PUT, `expectedLockVersion`); 409 ⇒ GIỮ số đã gõ + "Tải bản mới" (§5.2). */
export function SavePayslip({ payslip: p, check, dirty, onReload }: Props) {
  const save = useMutation({
    mutationFn: () =>
      check.ok
        ? payrollApi.putPayslip(p.period, p.userId, {
            ...check.body,
            expectedLockVersion: p.lockVersion,
          })
        : Promise.reject(new Error('form')),
    onSuccess: (r, _v, _c, context) => {
      context.client.setQueryData(payrollKeys.payslip(p.period, p.userId), r);
      void context.client.invalidateQueries({ queryKey: payrollKeys.run(p.period) });
      toast({ title: `Đã lưu phiếu của ${p.fullName}`, tone: 'success' });
    },
  });
  const conflict = isApiError(save.error, 'VERSION_CONFLICT');
  return (
    <div className="flex flex-col gap-2">
      {save.isError && (
        <Alert>
          {conflict
            ? 'Phiếu vừa được người khác sửa. Số bạn gõ vẫn còn — bấm "Tải bản mới" để xem bản kia (số đang gõ sẽ mất).'
            : serverErrorMessage(save.error)}
          {conflict && (
            <Button size="sm" variant="secondary" className="mt-2" onClick={onReload}>
              Tải bản mới
            </Button>
          )}
        </Alert>
      )}
      <Button
        className="self-end"
        disabled={!check.ok || !dirty}
        loading={save.isPending}
        onClick={() => save.mutate()}
      >
        Lưu phiếu
      </Button>
    </div>
  );
}
