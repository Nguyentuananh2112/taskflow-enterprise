'use client';

import { useId } from 'react';

import { useProfileSuggestions } from '@/entities/company';
import { Input } from '@/shared/ui/input';

import type { ProfileForm } from '../lib/profile-form';

type Props = Readonly<{
  value: ProfileForm;
  onChange: (next: ProfileForm) => void;
  /** Hôm nay theo server — ngày vào công ty không sau hôm nay. */
  today: string;
  /** Ẩn ô ngày (nhận lại + "Giữ ngày vào cũ"). */
  hideHireDate?: boolean;
}>;

/**
 * Bốn trường hồ sơ (ADR-128, đều không bắt buộc): ngày vào công ty, phòng ban, chức vụ (gợi ý từ những giá trị đã
 * dùng — datalist gốc của trình duyệt, gõ tự do vẫn được), SĐT công việc.
 */
export function ProfileFields({ value, onChange, today, hideHireDate = false }: Props) {
  const ids = useId();
  const hints = useProfileSuggestions(true).data;
  const set = (k: keyof ProfileForm) => (e: { target: { value: string } }) =>
    onChange({ ...value, [k]: e.target.value });
  return (
    <>
      {!hideHireDate && (
        <Input
          label="Ngày vào công ty"
          type="date"
          min="1950-01-01"
          max={today}
          value={value.hireDate}
          onChange={set('hireDate')}
          hint="Dùng cho phụ cấp thâm niên và phép năm."
        />
      )}
      <Input
        label="Phòng ban"
        autoComplete="off"
        maxLength={100}
        list={`${ids}-dept`}
        value={value.department}
        onChange={set('department')}
      />
      <Input
        label="Chức vụ"
        autoComplete="off"
        maxLength={100}
        list={`${ids}-title`}
        value={value.jobTitle}
        onChange={set('jobTitle')}
      />
      <Input
        label="Số điện thoại công việc"
        type="tel"
        inputMode="tel"
        autoComplete="off"
        maxLength={32}
        value={value.workPhone}
        onChange={set('workPhone')}
        hint="Số dùng cho công việc — không nhập số cá nhân."
      />
      <datalist id={`${ids}-dept`}>
        {hints?.departments.map((d) => (
          <option key={d} value={d} />
        ))}
      </datalist>
      <datalist id={`${ids}-title`}>
        {hints?.jobTitles.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
    </>
  );
}
