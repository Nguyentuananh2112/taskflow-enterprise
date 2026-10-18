'use client';

import type { PayrollSettingsDto } from '@taskflow/contracts/payroll';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { payrollApi, payrollKeys } from '@/entities/payroll';
import { isApiError } from '@/shared/api';
import { serverErrorMessage } from '@/shared/lib/form-errors';
import { formatVnd, groupDigits, parseVnd } from '@/shared/lib/money';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { MoneyInput } from '@/shared/ui/money-input';
import { toast } from '@/shared/ui/toast';

/**
 * Mức phụ cấp thâm niên / năm của công ty (payroll §0, mặc định 500.000). Đổi khi có bảng NHÁP ⇒ nháp giữ số cũ tới khi
 * "Tính lại công" (việc còn lại cảnh báo); bảng đã phát hành không đổi.
 */
export function SenioritySetting({ settings }: Readonly<{ settings: PayrollSettingsDto }>) {
  const [value, setValue] = useState(groupDigits(settings.seniorityPerYear));
  const amount = parseVnd(value);
  const save = useMutation({
    mutationFn: () => payrollApi.putSettings(amount ?? 0, settings.version),
    onSuccess: (r, _v, _c, context) => {
      context.client.setQueryData(payrollKeys.settings(), r);
      toast({ title: 'Đã lưu mức thâm niên. Bảng nháp cần "Tính lại công".', tone: 'success' });
    },
  });
  return (
    <section
      aria-labelledby="seniority"
      className="flex flex-col gap-2 rounded-card border border-border bg-surface p-4"
    >
      <h2 id="seniority" className="text-base font-semibold">
        Phụ cấp thâm niên
      </h2>
      <p className="text-sm text-text-muted">
        Mỗi năm làm việc tròn được {formatVnd(settings.seniorityPerYear)}/tháng (dưới 1 năm: 0).
        Tính theo ngày vào công ty do HR nhập.
      </p>
      {save.isError && (
        <Alert>
          {isApiError(save.error, 'VERSION_CONFLICT')
            ? 'Mức này vừa được người khác đổi — tải lại trang.'
            : serverErrorMessage(save.error)}
        </Alert>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-56">
          <MoneyInput label="Mức mỗi năm" value={value} onChange={setValue} />
        </div>
        <Button
          variant="secondary"
          loading={save.isPending}
          disabled={amount === null || amount === settings.seniorityPerYear}
          onClick={() => save.mutate()}
        >
          Lưu mức
        </Button>
      </div>
    </section>
  );
}
