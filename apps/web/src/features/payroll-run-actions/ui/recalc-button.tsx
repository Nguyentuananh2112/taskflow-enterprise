'use client';

import type { PayrollRunDto } from '@taskflow/contracts/payroll';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { payrollApi, payrollKeys } from '@/entities/payroll';
import { serverErrorMessage } from '@/shared/lib/form-errors';
import { Button } from '@/shared/ui/button';
import { Dialog } from '@/shared/ui/dialog';
import { toast } from '@/shared/ui/toast';

/**
 * "Tính lại công" (ADR-127): hỏi server TRƯỚC ("N người thay đổi công") rồi mới áp; giữ dòng gõ tay và công sửa tay có
 * lý do. Kỳ quá hạn lưu chấm công ⇒ nút mờ + lý do.
 */
export function RecalcButton({ run }: Readonly<{ run: PayrollRunDto }>) {
  const [changed, setChanged] = useState<number | null>(null);
  const onError = (error: unknown) => toast({ title: serverErrorMessage(error), tone: 'error' });
  const preview = useMutation({
    mutationFn: () => payrollApi.recalcPreview(run.period),
    onSuccess: (r) => setChanged(r.changedCount),
    onError,
  });
  const apply = useMutation({
    mutationFn: () => payrollApi.recalc(run.period),
    onSuccess: (r, _v, _c, context) => {
      context.client.setQueryData(payrollKeys.run(run.period), r);
      toast({ title: 'Đã tính lại công', tone: 'success' });
      setChanged(null);
    },
    onError,
  });
  if (!run.recalculable) {
    return (
      <span className="text-xs text-text-muted">
        Không tính lại công được — kỳ này có ngày đã quá hạn lưu chấm công.
      </span>
    );
  }
  return (
    <>
      <Button variant="secondary" loading={preview.isPending} onClick={() => preview.mutate()}>
        Tính lại công
      </Button>
      <Dialog
        open={changed !== null}
        onOpenChange={(open) => !open && setChanged(null)}
        title="Tính lại công?"
        description={
          changed === 0
            ? 'Không ai thay đổi công. Vẫn tính lại để lấy hồ sơ lương / mức thâm niên mới nhất?'
            : `${changed ?? 0} người thay đổi công. Dòng đã gõ và công sửa tay được giữ.`
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setChanged(null)}>
              Hủy
            </Button>
            <Button loading={apply.isPending} onClick={() => apply.mutate()}>
              Tính lại
            </Button>
          </>
        }
      />
    </>
  );
}
