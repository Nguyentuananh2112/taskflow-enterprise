import { cn } from '@/shared/lib/cn';

type Props = Readonly<{ className?: string }>;

/**
 * Khối giữ chỗ khi đang tải. Luôn `aria-hidden`: vùng chứa nó phải tự báo trạng thái
 * (vd `role="status"` + `aria-busy="true"` + `aria-label`, hoặc một <Spinner> có nhãn — `aria-label` trên div không có role là vi phạm ARIA) — skeleton chỉ là hình.
 */
export function Skeleton({ className }: Props) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-control bg-border/70', className)}
    />
  );
}
