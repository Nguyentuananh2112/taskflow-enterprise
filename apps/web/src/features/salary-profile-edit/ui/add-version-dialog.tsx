'use client';

import type { SalaryProfileDto } from '@taskflow/contracts/payroll';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { payrollApi, payrollKeys } from '@/entities/payroll';
import { isApiError } from '@/shared/api';
import { serverErrorMessage } from '@/shared/lib/form-errors';
import { parseVnd } from '@/shared/lib/money';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Dialog } from '@/shared/ui/dialog';
import { Input } from '@/shared/ui/input';
import { MoneyInput } from '@/shared/ui/money-input';
import { toast } from '@/shared/ui/toast';

type Props = Readonly<{ row: SalaryProfileDto; thisMonth: string }>;

/**
 * Phiên bản hồ sơ lương mới (ADR-125): áp từ tháng X (gồm cả X), cấp bậc, lương cơ bản > 0. Không sửa phiên bản cũ —
 * lịch sử giữ nguyên; trùng tháng ⇒ 409 lời thường.
 */
export function AddVersionDialog({ row, thisMonth }: Props) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    effectiveFrom: thisMonth,
    level: row.current?.level ?? '',
    baseSalary: '',
  });
  const base = parseVnd(form.baseSalary);
  const save = useMutation({
    mutationFn: () =>
      payrollApi.addProfileVersion(row.userId, {
        effectiveFrom: form.effectiveFrom,
        level: form.level.trim(),
        baseSalary: base ?? 0,
      }),
    onSuccess: (_r, _v, _c, context) => {
      void context.client.invalidateQueries({ queryKey: payrollKeys.profiles() });
      toast({ title: `Đã lưu hồ sơ lương của ${row.user.fullName}`, tone: 'success' });
      setOpen(false);
    },
  });
  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        aria-label={`Đổi lương của ${row.user.fullName}`}
        onClick={() => setOpen(true)}
      >
        Đổi lương
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={`Hồ sơ lương — ${row.user.fullName}`}
        description="Áp dụng từ tháng đã chọn trở đi. Các tháng trước giữ số cũ."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Hủy
            </Button>
            <Button
              loading={save.isPending}
              disabled={!form.effectiveFrom || !form.level.trim() || !base}
              onClick={() => save.mutate()}
            >
              Lưu
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {save.isError && (
            <Alert>
              {isApiError(save.error, 'RESOURCE_CONFLICT')
                ? 'Tháng này đã có phiên bản — chọn tháng khác.'
                : serverErrorMessage(save.error)}
            </Alert>
          )}
          <Input
            label="Áp dụng từ tháng"
            type="month"
            required
            value={form.effectiveFrom}
            onChange={(e) => setForm((f) => ({ ...f, effectiveFrom: e.target.value }))}
          />
          <Input
            label="Cấp bậc"
            required
            maxLength={32}
            value={form.level}
            onChange={(e) => setForm((f) => ({ ...f, level: e.target.value }))}
          />
          <MoneyInput
            label="Lương cơ bản (đủ công)"
            value={form.baseSalary}
            onChange={(baseSalary) => setForm((f) => ({ ...f, baseSalary }))}
          />
        </div>
      </Dialog>
    </>
  );
}
