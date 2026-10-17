'use client';

import type { PayslipDto } from '@taskflow/contracts/payroll';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { payrollKeys, payrollApi } from '@/entities/payroll';
import { serverErrorMessage } from '@/shared/lib/form-errors';
import { formatVnd } from '@/shared/lib/money';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Textarea } from '@/shared/ui/textarea';
import { toast } from '@/shared/ui/toast';

import type { FormCheck } from '../lib/form-state';

type Props = Readonly<{
  payslip: PayslipDto;
  check: FormCheck;
  dirty: boolean;
  onDone: () => void;
}>;

const ROWS = [
  ['(1) Tiền lương chi tiết', 'incomeTotal'],
  ['(2) Thưởng', 'bonusTotal'],
  ['(3) Giảm trừ', 'deductionTotal'],
  ['(4) Tổng thực lĩnh', 'netPay'],
] as const;

/**
 * Bản điều chỉnh (ADR-125): lý do bắt buộc (nhân viên xem được), XEM KHÁC BIỆT trước khi gửi (§5.2). Gửi `expectedRevision`
 * — đã có bản mới hơn ⇒ 409.
 */
export function RevisePayslip({ payslip: p, check, dirty, onDone }: Props) {
  const [reason, setReason] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const send = useMutation({
    mutationFn: () =>
      check.ok
        ? payrollApi.revise(p.period, p.userId, {
            ...check.body,
            expectedRevision: p.revision,
            reason: reason.trim(),
          })
        : Promise.reject(new Error('form')),
    onSuccess: (r, _v, _c, context) => {
      context.client.setQueryData(payrollKeys.payslip(p.period, p.userId), r);
      void context.client.invalidateQueries({ queryKey: payrollKeys.run(p.period) });
      toast({
        title: `Đã tạo bản điều chỉnh lần ${r.revision - 1} cho ${p.fullName}`,
        tone: 'success',
      });
      onDone();
    },
  });
  const changes = check.ok ? ROWS.filter(([, k]) => p[k] !== check.totals[k]) : [];
  return (
    <div className="flex flex-col gap-3">
      <Textarea
        label="Lý do điều chỉnh"
        required
        rows={2}
        maxLength={500}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        hint="Nhân viên sẽ thấy lý do này trên phiếu."
      />
      {reviewing && check.ok && (
        <section aria-label="Khác biệt" className="rounded-card border border-border p-3 text-sm">
          <h3 className="font-semibold">Khác biệt so với bản {p.revision}</h3>
          {changes.length === 0 ? (
            <p>Số tiền không đổi (chỉ đổi nhãn / ghi chú).</p>
          ) : (
            <ul className="mt-1 flex flex-col gap-1">
              {changes.map(([label, k]) => (
                <li key={k} className="tabular-nums">
                  {label}: {formatVnd(p[k])} → <strong>{formatVnd(check.totals[k])}</strong>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {send.isError && <Alert>{serverErrorMessage(send.error)}</Alert>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>
          Hủy
        </Button>
        {reviewing ? (
          <Button loading={send.isPending} onClick={() => send.mutate()}>
            Gửi bản điều chỉnh
          </Button>
        ) : (
          <Button
            disabled={!check.ok || !dirty || !reason.trim()}
            onClick={() => setReviewing(true)}
          >
            Xem khác biệt
          </Button>
        )}
      </div>
    </div>
  );
}
