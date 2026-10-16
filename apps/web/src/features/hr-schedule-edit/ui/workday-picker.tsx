import { WEEKDAYS } from '../model/workdays';

type Props = Readonly<{ value: number; onChange: (mask: number) => void }>;

/** Ngày làm trong tuần (bitmask: bit 0 = thứ Hai … bit 6 = Chủ nhật — A). */
export function WorkdayPicker({ value, onChange }: Props) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium">Ngày làm việc</legend>
      <div className="flex flex-wrap gap-3">
        {WEEKDAYS.map((label, bit) => (
          <label key={label} className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={(value & (1 << bit)) !== 0}
              onChange={(e) =>
                onChange(e.target.checked ? value | (1 << bit) : value & ~(1 << bit))
              }
            />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
