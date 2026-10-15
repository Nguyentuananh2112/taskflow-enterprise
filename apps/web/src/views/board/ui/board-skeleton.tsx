import { Skeleton } from '@/shared/ui/skeleton';

/** Skeleton 4 cột × 3 thẻ (frontend.md §1.2). */
export function BoardSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Đang tải bảng"
      className="flex gap-3 overflow-hidden"
    >
      {[0, 1, 2, 3].map((column) => (
        <div
          key={column}
          className="flex w-72 shrink-0 flex-col gap-2 rounded-card bg-bg-subtle p-2"
        >
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ))}
    </div>
  );
}
