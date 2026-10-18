'use client';

import {
  PublishBlockedDetails,
  type PayrollRunDto,
  type PublishBlockedDetails as Blocked,
} from '@taskflow/contracts/payroll';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { BLOCK_REASON, monthLabel, payrollApi, payrollKeys, payslipKeys } from '@/entities/payroll';
import { isApiError } from '@/shared/api';
import { serverErrorMessage } from '@/shared/lib/form-errors';
import { formatVnd } from '@/shared/lib/money';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Dialog } from '@/shared/ui/dialog';
import { toast } from '@/shared/ui/toast';

type Props = Readonly<{ run: PayrollRunDto }>;

/**
 * "Phát hành" (payroll.md §5.2): tóm tắt số phiếu + tổng thực lĩnh + cảnh báo ngày quên chấm ra, ô tick "Tôi đã kiểm
 * tra" bắt buộc. Bị chặn (422 PUBLISH_BLOCKED) ⇒ liệt kê từng người + lý do (tên lấy từ bảng — server không gửi tên).
 */
export function PublishDialog({ run }: Props) {
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState(false);
  const [blocked, setBlocked] = useState<Blocked['blockers'] | null>(null);
  const total = run.payslips.reduce((n, p) => n + p.netPay, 0);
  const missingOut = run.todo.filter((t) => t.kind === 'MISSING_OUT');
  const nameOf = (id: string) => run.payslips.find((p) => p.user.id === id)?.user.fullName ?? id;
  // Mở / đóng (Hủy, Esc, xong) đều qua đây ⇒ ô "Tôi đã kiểm tra" và danh sách bị chặn cũ không sót lại (H soát T-050).
  const show = (next: boolean) => {
    setOpen(next);
    setChecked(false);
    setBlocked(null);
  };
  const publish = useMutation({
    mutationFn: () => {
      setBlocked(null);
      return payrollApi.publish(run.period);
    },
    onSuccess: (r, _v, _c, context) => {
      context.client.setQueryData(payrollKeys.run(run.period), r);
      void context.client.invalidateQueries({ queryKey: payrollKeys.runs() });
      void context.client.invalidateQueries({ queryKey: payslipKeys.all() });
      toast({ title: `Đã phát hành bảng lương tháng ${monthLabel(run.period)}`, tone: 'success' });
      show(false);
    },
    onError: (error) => {
      const details = isApiError(error) ? PublishBlockedDetails.safeParse(error.details) : null;
      if (details?.success) setBlocked(details.data.blockers);
    },
  });
  return (
    <>
      <Button onClick={() => show(true)}>Phát hành</Button>
      <Dialog
        open={open}
        onOpenChange={show}
        title={`Phát hành bảng lương tháng ${monthLabel(run.period)}?`}
        description="Sau khi phát hành, nhân viên thấy phiếu và số không sửa được (sai thì tạo bản điều chỉnh)."
        footer={
          <>
            <Button variant="secondary" onClick={() => show(false)}>
              Hủy
            </Button>
            <Button
              disabled={!checked}
              loading={publish.isPending}
              onClick={() => publish.mutate()}
            >
              Phát hành
            </Button>
          </>
        }
      >
        <p className="text-sm">
          {run.payslips.length} phiếu · tổng thực lĩnh{' '}
          <strong className="whitespace-nowrap tabular-nums">{formatVnd(total)}</strong>
        </p>
        {missingOut.length > 0 && (
          <Alert tone="info">
            Còn {missingOut.length} ngày quên chấm ra (chưa tính công):{' '}
            {missingOut
              .map((t) => t.user?.fullName)
              .filter(Boolean)
              .join(', ')}
            .
          </Alert>
        )}
        {blocked && (
          <Alert>
            Chưa phát hành được:
            <ul className="mt-1 list-disc pl-5">
              {blocked.map((b) => (
                <li key={b.userId}>
                  {nameOf(b.userId)}: {b.reasons.map((r) => BLOCK_REASON[r]).join(', ')}
                </li>
              ))}
            </ul>
          </Alert>
        )}
        {publish.isError && !blocked && <Alert>{serverErrorMessage(publish.error)}</Alert>}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          Tôi đã kiểm tra
        </label>
      </Dialog>
    </>
  );
}
