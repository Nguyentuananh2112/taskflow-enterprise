import { cn } from '@/shared/lib/cn';
import { formatDateOnly, isOverdue } from '@/shared/lib/date-only';

type Props = Readonly<{
  dueDate: string | null;
  /** Task đã hoàn thành thì không cảnh báo quá hạn (wireframe §1.4). */
  done: boolean;
}>;

/** Hạn chót; quá hạn ⇒ màu cảnh báo + chữ "Quá hạn" (không chỉ dựa vào màu). */
export function DueDate({ dueDate, done }: Props) {
  if (dueDate === null) return null;
  const overdue = !done && isOverdue(dueDate);
  return (
    <span className={cn('text-xs', overdue ? 'font-medium text-warning' : 'text-text-muted')}>
      <span aria-hidden="true">{overdue ? '⚠ ' : '📅 '}</span>
      <span className="sr-only">{overdue ? 'Quá hạn, hạn chót ' : 'Hạn chót '}</span>
      <time dateTime={dueDate}>{formatDateOnly(dueDate)}</time>
    </span>
  );
}
