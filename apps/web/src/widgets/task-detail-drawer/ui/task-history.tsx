'use client';

import { AuditEntry, useTaskAuditLogs, type AuditScope } from '@/entities/audit-log';
import { Button } from '@/shared/ui/button';
import { Skeleton } from '@/shared/ui/skeleton';

/** Tab "Lịch sử": GET …/audit-logs (cursor, mới nhất trước) — realtime invalidate (frontend.md §1.5). */
export function TaskHistory({ scope }: Readonly<{ scope: AuditScope }>) {
  const logs = useTaskAuditLogs(scope);
  const entries = logs.data?.pages.flatMap((page) => page.data) ?? [];
  return (
    <section aria-labelledby="task-history" className="flex flex-col gap-2">
      <h3 id="task-history" className="text-sm font-semibold">
        Lịch sử
      </h3>
      {logs.isPending && (
        <div role="status" aria-busy="true" aria-label="Đang tải lịch sử" className="grid gap-2">
          <Skeleton className="h-8" />
          <Skeleton className="h-8" />
        </div>
      )}
      {logs.isError && (
        <p className="text-sm text-danger">
          Không tải được lịch sử.{' '}
          <button type="button" className="underline" onClick={() => void logs.refetch()}>
            Thử lại
          </button>
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {entries.map((entry) => (
          <AuditEntry key={entry.id} entry={entry} />
        ))}
      </ul>
      {logs.hasNextPage && (
        <Button
          variant="ghost"
          size="sm"
          className="self-center"
          loading={logs.isFetchingNextPage}
          onClick={() => void logs.fetchNextPage()}
        >
          Tải thêm
        </Button>
      )}
    </section>
  );
}
