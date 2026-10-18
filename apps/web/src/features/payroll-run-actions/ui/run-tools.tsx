'use client';

import type { PayrollRunDto } from '@taskflow/contracts/payroll';
import { useMutation } from '@tanstack/react-query';

import { payrollApi, payrollKeys } from '@/entities/payroll';
import { isApiError } from '@/shared/api';
import { serverErrorMessage } from '@/shared/lib/form-errors';
import { saveBlob } from '@/shared/lib/save-blob';
import { Button } from '@/shared/ui/button';
import { toast } from '@/shared/ui/toast';

/** "Thêm người còn thiếu" (nháp) — người mới có nhiệm kỳ giao kỳ sau khi tạo bảng. */
export function AddMissingButton({ period }: Readonly<{ period: string }>) {
  const add = useMutation({
    mutationFn: () => payrollApi.addMissing(period),
    onSuccess: (r, _v, _c, context) => {
      context.client.setQueryData(payrollKeys.run(period), r);
      toast({ title: 'Đã thêm người còn thiếu', tone: 'success' });
    },
    onError: (error) => toast({ title: serverErrorMessage(error), tone: 'error' }),
  });
  return (
    <Button variant="secondary" loading={add.isPending} onClick={() => add.mutate()}>
      Thêm người còn thiếu
    </Button>
  );
}

/** Tải bảng lương .xlsx (ADR-130 qua `ISpreadsheetWriter`) — fetch có Bearer → Blob; tên file từ server. */
export function ExportRunButton({ run }: Readonly<{ run: PayrollRunDto }>) {
  const download = useMutation({
    mutationFn: () => payrollApi.exportXlsx(run.period),
    onSuccess: ({ blob, filename }) => saveBlob(blob, filename ?? `bang-luong-${run.period}.xlsx`),
    onError: (error) =>
      toast({
        title: isApiError(error, 'RATE_LIMITED')
          ? 'Bạn vừa xuất nhiều lần — thử lại sau ít phút.'
          : 'Không tạo được file, thử lại.',
        tone: 'error',
      }),
  });
  return (
    <Button
      variant="secondary"
      disabled={download.isPending}
      title="File chứa lương của nhân viên — chỉ lưu ở nơi an toàn."
      onClick={() => download.mutate()}
    >
      {download.isPending ? 'Đang tạo file…' : 'Tải Excel'}
    </Button>
  );
}
