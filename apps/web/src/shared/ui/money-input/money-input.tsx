'use client';

import { useState } from 'react';

import { reformatVndInput, regroupTyped } from '@/shared/lib/money';

import { Input } from '../input';

type Props = Readonly<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Lỗi của CHÍNH ô này (vd chữ cái) — hiện dưới ô + aria-invalid. */
  error?: string | undefined;
}>;

const NEGATIVE = 'Không nhập số âm — dấu do mục quyết định (giảm trừ đã là trừ).';

/**
 * Ô tiền (§5.2): bàn phím số trên điện thoại, chữ to, chèn dấu chấm nghìn NGAY khi gõ / dán ("7000000", "7,000,000" ⇒
 * "7.000.000"). Dấu trừ không được nhận — báo rõ thay vì bỏ lặng lẽ (dấu do mục quyết định).
 */
export function MoneyInput({ label, value, onChange, error }: Props) {
  const [negative, setNegative] = useState(false);
  return (
    <Input
      label={label}
      inputMode="numeric"
      autoComplete="off"
      className="text-right text-base tabular-nums"
      value={value}
      onChange={(e) => {
        const raw = e.target.value;
        setNegative(raw.includes('-'));
        const clean = raw.replace(/-/g, '');
        // Gõ 1 phím ⇒ nhóm lại chữ số; dán cả chuỗi ⇒ kiểm chặt (dán "7.5" không thành 75).
        const typed = Math.abs(clean.length - value.length) <= 1;
        onChange(typed ? regroupTyped(clean) : reformatVndInput(clean));
      }}
      hint="đồng"
      error={negative ? NEGATIVE : error}
    />
  );
}
