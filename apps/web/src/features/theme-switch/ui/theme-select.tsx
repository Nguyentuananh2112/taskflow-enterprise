'use client';

import { setThemePref, useThemePref, type ThemePref } from '@/shared/lib/theme';
import { Select } from '@/shared/ui/select';

const OPTIONS: ReadonlyArray<{ value: ThemePref; label: string }> = [
  { value: 'system', label: 'Theo hệ thống' },
  { value: 'light', label: 'Sáng' },
  { value: 'dark', label: 'Tối' },
];

const isPref = (value: string): value is ThemePref => OPTIONS.some((o) => o.value === value);

/** Chọn giao diện Sáng / Tối / Theo hệ thống (frontend.md §6.1) — áp ngay, nhớ trên trình duyệt này. */
export function ThemeSelect() {
  const pref = useThemePref();
  return (
    <Select
      label="Giao diện"
      className="sm:w-56"
      options={OPTIONS}
      value={pref}
      onChange={(event) => {
        if (isPref(event.target.value)) setThemePref(event.target.value);
      }}
    />
  );
}
