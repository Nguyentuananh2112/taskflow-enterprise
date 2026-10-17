'use client';

import type { LeaveBalanceRowDto } from '@taskflow/contracts/leave';
import { useMutation, type InfiniteData } from '@tanstack/react-query';
import { useState } from 'react';

import { hrKeys, hrLeaveApi } from '@/entities/hr';
import { daysText } from '@/entities/leave';
import type { ApiResult } from '@/shared/api';
import { Button } from '@/shared/ui/button';
import { Dialog, DialogClose } from '@/shared/ui/dialog';
import { Input } from '@/shared/ui/input';
import { Textarea } from '@/shared/ui/textarea';
import { toast } from '@/shared/ui/toast';

import { adjustErrorMessage } from '../model/adjust-errors';

type Props = Readonly<{ row: LeaveBalanceRowDto; own: boolean }>;
type Pages = InfiniteData<ApiResult<LeaveBalanceRowDto[]>>;

/** Số hợp lệ: bước 0,5 (chấp nhận dấu phẩy kiểu Việt). */
function parseDays(text: string): number | null {
  const n = Number(text.trim().replace(',', '.'));
  return text.trim() !== '' && Number.isFinite(n) && Number.isInteger(n * 2) ? n : null;
}

/**
 * Chỉnh "điều chỉnh" số phép năm (PATCH — GIÁ TRỊ MỚI tuyệt đối, bước 0,5, được âm; D chốt). Người vào
 * giữa năm: HR tự giảm theo tỷ lệ tháng. Tự chỉnh của mình: chỉ Admin, bắt buộc ghi chú (B-H1). Kết quả
 * thay đúng một dòng trong cache (không tải lại cả bảng).
 */
export function AdjustBalanceButton({ row, own }: Props) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(String(row.adjustmentDays));
  const [note, setNote] = useState('');
  const days = parseDays(value);
  const save = useMutation({
    mutationFn: () =>
      hrLeaveApi.adjustBalance(row.userId, row.year, {
        adjustmentDays: days ?? 0,
        ...(note.trim() ? { note: note.trim() } : {}),
      }),
    onSuccess: (next, _v, _r, context) => {
      context.client.setQueryData<Pages>(
        hrKeys.balances(row.year),
        (old) =>
          old && {
            ...old,
            pages: old.pages.map((p) => ({
              ...p,
              data: p.data.map((r) => (r.userId === next.userId ? next : r)),
            })),
          },
      );
      toast({ title: `Đã cập nhật số phép của ${row.user.fullName}`, tone: 'success' });
      setOpen(false);
      setNote('');
    },
    onError: (error) => toast({ title: adjustErrorMessage(error), tone: 'error' }),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setValue(String(row.adjustmentDays));
      }}
      trigger={
        <Button size="sm" variant="secondary" aria-label={`Chỉnh số phép của ${row.user.fullName}`}>
          Chỉnh
        </Button>
      }
      title={`Số phép năm ${row.year} của ${row.user.fullName}`}
      description={`Được hưởng ${daysText(row.entitledDays)}, đã dùng ${daysText(row.usedDays)}. Nhập tổng số ngày điều chỉnh (số âm để trừ).`}
      footer={
        <>
          <DialogClose>
            <Button variant="secondary">Hủy</Button>
          </DialogClose>
          <Button
            loading={save.isPending}
            disabled={days === null || (own && !note.trim())}
            onClick={() => save.mutate()}
          >
            Lưu
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Input
          label="Điều chỉnh (ngày)"
          inputMode="decimal"
          value={value}
          error={days === null ? 'Nhập số, bước 0,5 (vd 1,5 hoặc -2)' : undefined}
          onChange={(e) => setValue(e.target.value)}
        />
        <Textarea
          label={own ? 'Lý do' : 'Ghi chú (tùy chọn)'}
          rows={2}
          maxLength={500}
          required={own}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
    </Dialog>
  );
}
