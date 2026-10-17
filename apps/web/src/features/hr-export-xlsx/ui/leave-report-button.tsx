'use client';

import { useState } from 'react';

import { hrLeaveApi } from '@/entities/hr';
import { Button } from '@/shared/ui/button';
import { Dialog } from '@/shared/ui/dialog';
import { Input } from '@/shared/ui/input';

import { XlsxButton } from './xlsx-button';

type Props = Readonly<{ year: number }>;

/** "Tải báo cáo nghỉ phép" (ADR-130): năm đang xem + khoảng ngày trong năm (mặc định cả năm). */
export function LeaveReportButton({ year }: Props) {
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState({ from: `${year}-01-01`, to: `${year}-12-31` });
  const inYear = (d: string) => d.startsWith(`${year}-`);
  const valid = inYear(range.from) && inYear(range.to) && range.from <= range.to;
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Tải báo cáo nghỉ phép
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={`Báo cáo nghỉ phép năm ${year}`}
        description="Số phép từng người và các đơn đã duyệt trong khoảng ngày đã chọn."
        footer={
          <XlsxButton
            label="Tải Excel"
            fallbackName={`nghi-phep-${year}.xlsx`}
            disabled={!valid}
            download={() => hrLeaveApi.exportXlsx({ year, from: range.from, to: range.to })}
          />
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Từ ngày"
            type="date"
            min={`${year}-01-01`}
            max={`${year}-12-31`}
            value={range.from}
            onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
          />
          <Input
            label="Đến ngày"
            type="date"
            min={`${year}-01-01`}
            max={`${year}-12-31`}
            value={range.to}
            onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
            error={valid ? undefined : 'Chọn ngày trong năm, "Đến ngày" không trước "Từ ngày".'}
          />
        </div>
      </Dialog>
    </>
  );
}
