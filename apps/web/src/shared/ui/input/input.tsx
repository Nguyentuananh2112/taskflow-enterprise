import type { InputHTMLAttributes, Ref } from 'react';

import { cn } from '@/shared/lib/cn';
import { useFieldIds } from '@/shared/lib/use-field-ids';

export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'children'> &
  Readonly<{
    /** Bắt buộc: mọi ô nhập phải có nhãn nhìn thấy được (a11y). */
    label: string;
    hint?: string;
    /** Thông báo lỗi (client hoặc server — frontend.md §7.3). Có ⇒ aria-invalid. */
    error?: string | undefined;
    ref?: Ref<HTMLInputElement>;
  }>;

export const controlClass = cn(
  'w-full rounded-control border bg-surface px-3 text-sm text-text',
  'placeholder:text-text-muted disabled:cursor-not-allowed disabled:opacity-60',
);

export function Input({ label, hint, error, id, className, required, ...rest }: InputProps) {
  const ids = useFieldIds({ id, hint, error });
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={ids.id} className="text-sm font-medium text-text">
        {label}
        {required && (
          <span aria-hidden="true" className="text-danger">
            {' '}
            *
          </span>
        )}
      </label>
      <input
        id={ids.id}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={ids.describedBy}
        className={cn(controlClass, 'h-10', error ? 'border-danger' : 'border-border', className)}
        {...rest}
      />
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
