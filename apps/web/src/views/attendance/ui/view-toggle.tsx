import { cn } from '@/shared/lib/cn';

import type { ViewMode } from '../model/use-view-mode';

const OPTIONS: ReadonlyArray<{ value: ViewMode; label: string }> = [
  { value: 'calendar', label: 'Lịch' },
  { value: 'list', label: 'Danh sách' },
];

/** Nút chuyển Lịch / Danh sách (nhóm nút bật-tắt, `aria-pressed`). */
export function ViewToggle({
  mode,
  onChange,
}: Readonly<{ mode: ViewMode; onChange: (mode: ViewMode) => void }>) {
  return (
    <div
      role="group"
      aria-label="Cách xem"
      className="inline-flex rounded-control border border-border p-0.5"
    >
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={mode === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-control px-3 py-1 text-sm',
            mode === o.value ? 'bg-primary text-primary-fg' : 'hover:bg-bg-subtle',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
