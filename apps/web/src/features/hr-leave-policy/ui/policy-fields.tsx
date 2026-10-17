'use client';

import { Input } from '@/shared/ui/input';
import { Select } from '@/shared/ui/select';

import { MONTHS } from '../lib/policy-example';

/** Số liệu là CHUỖI trong ô nhập (cho phép gõ dở "12,"); form kiểm bằng schema contracts trước khi lưu. */
export type PolicyFormState = Readonly<{
  annualDays: string;
  seniorityStepYears: string;
  seniorityBonusDays: string;
  carryOverEnabled: boolean;
  carryOverMaxDays: string;
  carryOverExpiryMonth: string;
}>;

type Props = Readonly<{
  value: PolicyFormState;
  onChange: (update: (s: PolicyFormState) => PolicyFormState) => void;
}>;

/** Ô nhập chính sách phép: phép năm, bậc thâm niên, cho chuyển phép sang năm sau (trần + hạn dùng). */
export function PolicyFields({ value, onChange }: Props) {
  const set = (k: keyof PolicyFormState) => (e: { target: { value: string } }) =>
    onChange((s) => ({ ...s, [k]: e.target.value }));
  return (
    <>
      <Input
        label="Số ngày phép năm"
        type="number"
        inputMode="decimal"
        min={12}
        max={30}
        step={0.5}
        value={value.annualDays}
        onChange={set('annualDays')}
        hint="Tối thiểu 12 ngày — theo Bộ luật Lao động."
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="Cứ mỗi … năm làm việc"
          type="number"
          min={1}
          max={5}
          step={1}
          value={value.seniorityStepYears}
          onChange={set('seniorityStepYears')}
          hint="Luật: 5 năm (không quá 5)."
        />
        <Input
          label="… được thêm số ngày"
          type="number"
          inputMode="decimal"
          min={1}
          max={5}
          step={0.5}
          value={value.seniorityBonusDays}
          onChange={set('seniorityBonusDays')}
          hint="Luật: 1 ngày (ít nhất 1)."
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={value.carryOverEnabled}
          onChange={(e) => onChange((s) => ({ ...s, carryOverEnabled: e.target.checked }))}
        />
        Cho chuyển phép chưa dùng sang năm sau
      </label>
      {value.carryOverEnabled && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Tối đa số ngày"
            type="number"
            inputMode="decimal"
            min={0}
            max={30}
            step={0.5}
            value={value.carryOverMaxDays}
            onChange={set('carryOverMaxDays')}
          />
          <Select
            label="Dùng trước hết tháng"
            options={MONTHS}
            value={value.carryOverExpiryMonth}
            onChange={set('carryOverExpiryMonth')}
          />
        </div>
      )}
    </>
  );
}
