'use client';

import type { PayslipSection } from '@taskflow/contracts/payroll';
import type { ReactNode } from 'react';

import { formatVnd, parseVnd } from '@/shared/lib/money';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { MoneyInput } from '@/shared/ui/money-input';

import type { LineDraft } from '../lib/form-state';

/** Tên mục ngắn cho nhãn ô — trình đọc màn hình biết dòng thuộc mục nào. */
const SHORT: Readonly<Record<PayslipSection, string>> = {
  INCOME: 'Lương',
  BONUS: 'Thưởng',
  DEDUCTION: 'Giảm trừ',
};

type Props = Readonly<{
  title: string;
  section: PayslipSection;
  total: number;
  lines: readonly LineDraft[];
  onChange: (lines: readonly LineDraft[]) => void;
  /** Dòng hệ thống (lương theo công, thâm niên) — chỉ đọc, hiện trước dòng gõ tay. */
  fixed?: ReactNode;
}>;

/**
 * Một mục của phiếu (§5.2): dòng gõ tay = nhãn + số tiền, xếp DỌC ở 360 px (không lưới nhiều cột); "Thêm dòng"; xóa từng
 * dòng. Tổng mục là số xem trước (server tính lại khi lưu).
 */
export function LinesSection({ title, section, total, lines, onChange, fixed }: Props) {
  const mine = lines.filter((l) => l.section === section);
  const short = SHORT[section];
  const update = (key: string, patch: Partial<LineDraft>) =>
    onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  return (
    <fieldset className="flex flex-col gap-3 rounded-card border border-border p-3">
      <legend className="flex w-full items-center justify-between gap-2 px-1 font-semibold">
        <span>{title}</span>
        <span className="whitespace-nowrap tabular-nums">{formatVnd(total)}</span>
      </legend>
      {fixed}
      {mine.map((l, i) => (
        <div
          key={l.key}
          className="grid gap-2 border-t border-border pt-3 sm:grid-cols-[1fr_12rem_auto] sm:items-start"
        >
          <Input
            label={`Nhãn — ${short}, dòng ${i + 1}`}
            maxLength={120}
            value={l.label}
            onChange={(e) => update(l.key, { label: e.target.value })}
          />
          <MoneyInput
            label={`Số tiền — ${short}, dòng ${i + 1}`}
            value={l.amount}
            onChange={(amount) => update(l.key, { amount })}
            error={parseVnd(l.amount) === null ? 'Chỉ nhập chữ số (vd 1.500.000).' : undefined}
          />
          <Button
            size="sm"
            variant="ghost"
            className="sm:mt-6"
            aria-label={`Xóa — ${short}, dòng ${i + 1}`}
            onClick={() => onChange(lines.filter((x) => x.key !== l.key))}
          >
            Xóa
          </Button>
        </div>
      ))}
      <Button
        size="sm"
        variant="secondary"
        className="self-start"
        disabled={lines.length >= 50}
        onClick={() =>
          onChange([...lines, { key: crypto.randomUUID(), section, label: '', amount: '' }])
        }
      >
        Thêm dòng — {title}
      </Button>
    </fieldset>
  );
}
