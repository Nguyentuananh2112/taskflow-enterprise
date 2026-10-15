import type { Ref, SelectHTMLAttributes } from 'react';

import { cn } from '@/shared/lib/cn';
import { useFieldIds } from '@/shared/lib/use-field-ids';

// Select dùng <select> gốc (ĐỀ XUẤT T-012): a11y, bàn phím và bộ chọn trên mobile do trình duyệt lo,
// không cần JS. Danh sách cần tìm kiếm (người phụ trách) sẽ dùng Combobox riêng (Phase 4).

export type SelectOption = Readonly<{ value: string; label: string; disabled?: boolean }>;

export type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> &
  Readonly<{
    label: string;
    options: readonly SelectOption[];
    /** Dòng đầu không chọn được, vd "Chọn vai trò…". */
    placeholder?: string;
    hint?: string | undefined;
    error?: string | undefined;
    ref?: Ref<HTMLSelectElement>;
  }>;

export function Select({
  label,
  options,
  placeholder,
  hint,
  error,
  id,
  className,
  ...rest
}: SelectProps) {
  const ids = useFieldIds({ id, hint, error });
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={ids.id} className="text-sm font-medium text-text">
        {label}
      </label>
      <select
        id={ids.id}
        aria-invalid={error ? true : undefined}
        aria-describedby={ids.describedBy}
        className={cn(
          'h-10 w-full rounded-control border bg-surface px-3 text-sm text-text',
          'disabled:cursor-not-allowed disabled:opacity-60',
          error ? 'border-danger' : 'border-border',
          className,
        )}
        {...rest}
      >
        {placeholder !== undefined && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      {hint && (
        <p id={ids.hintId} className="text-xs text-text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={ids.errorId} className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
