'use client';

import { useState } from 'react';

import { useLeavePolicy } from '@/entities/hr';
import { cn } from '@/shared/lib/cn';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Dialog } from '@/shared/ui/dialog';
import { Skeleton } from '@/shared/ui/skeleton';

import { PolicyForm } from './policy-form';

type Props = Readonly<{ today: string }>;

/**
 * "Cài chính sách phép" (ADR-131) trong tab Số phép: một bộ cho cả công ty theo năm — chỉ sửa Năm nay / Năm sau (năm
 * đã qua chỉ đọc ở server). Form dựng lại theo `version` ⇒ "Tải bản mới" sau 409 hiện bản của người kia.
 */
export function PolicyDialog({ today }: Props) {
  const thisYear = Number(today.slice(0, 4));
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(thisYear);
  const policy = useLeavePolicy(year, open);
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Cài chính sách phép
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Chính sách phép năm"
        description="Áp dụng cho cả công ty. Không thấp hơn mức của Bộ luật Lao động."
      >
        <div role="group" aria-label="Chọn năm" className="flex gap-2">
          {[thisYear, thisYear + 1].map((y) => (
            <button
              key={y}
              type="button"
              aria-pressed={year === y}
              onClick={() => setYear(y)}
              className={cn(
                'rounded-control px-3 py-1.5 text-sm',
                year === y ? 'bg-primary text-primary-fg' : 'hover:bg-bg-subtle',
              )}
            >
              {y === thisYear ? `Năm nay (${y})` : `Năm sau (${y})`}
            </button>
          ))}
        </div>
        {policy.data ? (
          <PolicyForm
            key={`${policy.data.year}-${policy.data.version}`}
            policy={policy.data}
            onReload={() => void policy.refetch()}
            onClose={() => setOpen(false)}
          />
        ) : policy.isError ? (
          <Alert>Không tải được chính sách phép.</Alert>
        ) : (
          <div
            role="status"
            aria-busy="true"
            aria-label="Đang tải chính sách"
            className="grid gap-3"
          >
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        )}
      </Dialog>
    </>
  );
}
