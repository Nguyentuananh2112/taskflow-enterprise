'use client';

import { reformatVndInput } from '@/shared/lib/money';

import { Input } from '../input';

type Props = Readonly<{ label: string; value: string; onChange: (value: string) => void }>;

/**
 * Ô tiền (§5.2): bàn phím số trên điện thoại, chữ to, tự chèn dấu chấm nghìn khi rời ô, hiểu dán "7,000,000" /
 * "7.000.000"; không có dấu trừ (dấu do mục quyết định).
 */
export function MoneyInput({ label, value, onChange }: Props) {
  return (
    <Input
      label={label}
      inputMode="numeric"
      autoComplete="off"
      className="text-right text-base tabular-nums"
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/-/g, ''))}
      onBlur={() => onChange(reformatVndInput(value))}
      hint="đồng"
    />
  );
}
