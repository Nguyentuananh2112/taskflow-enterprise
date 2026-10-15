import { useId } from 'react';

/** id cho control + mô tả + lỗi, và `aria-describedby` đã ghép sẵn (frontend.md §7.3). */
export function useFieldIds(opts: { id?: string | undefined; hint?: unknown; error?: unknown }) {
  const generated = useId();
  const id = opts.id ?? generated;
  const hintId = opts.hint ? `${id}-hint` : undefined;
  const errorId = opts.error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return { id, hintId, errorId, describedBy };
}
