import type { Ref, TextareaHTMLAttributes } from 'react';

import { cn } from '@/shared/lib/cn';
import { useFieldIds } from '@/shared/lib/use-field-ids';
import { controlClass } from '@/shared/ui/input';

export type TextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'children'> &
  Readonly<{
    label: string;
    hint?: string | undefined;
    error?: string | undefined;
    ref?: Ref<HTMLTextAreaElement>;
  }>;

/** Ô nhập nhiều dòng — cùng cấu trúc nhãn/mô tả/lỗi với Input (frontend.md §6.3). */
export function Textarea({ label, hint, error, id, className, rows = 5, ...rest }: TextareaProps) {
  const ids = useFieldIds({ id, hint, error });
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={ids.id} className="text-sm font-medium text-text">
        {label}
      </label>
      <textarea
        id={ids.id}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={ids.describedBy}
        className={cn(controlClass, 'py-2', error ? 'border-danger' : 'border-border', className)}
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
