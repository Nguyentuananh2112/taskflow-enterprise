'use client';

import { CORRECTION_STATUS_LABEL, correctionAsk, useMyCorrections } from '@/entities/correction';
import { dayLabel } from '@/entities/attendance';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';

/**
 * "Đơn bổ sung giờ của tôi" (ADR-129) — dưới bảng công: ngày · "Xin giờ ra 17:45" · trạng thái (chữ) · ghi chú của HR.
 * Chưa có đơn nào ⇒ không chiếm chỗ.
 */
export function MyCorrections() {
  const mine = useMyCorrections(true);
  const rows = mine.data?.pages.flatMap((p) => p.data) ?? [];
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="my-corrections" className="flex flex-col gap-2">
      <h2 id="my-corrections" className="text-base font-semibold">
        Đơn bổ sung giờ của tôi
      </h2>
      <ul className="flex flex-col gap-2">
        {rows.map((c) => (
          <li
            key={c.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-card border border-border bg-surface p-3 text-sm"
          >
            <span className="font-medium">{dayLabel(c.date)}</span>
            <span>{correctionAsk(c)}</span>
            <Badge>{CORRECTION_STATUS_LABEL[c.status]}</Badge>
            {c.decisionNote && (
              <span className="w-full text-text-muted">Ghi chú của nhân sự: {c.decisionNote}</span>
            )}
          </li>
        ))}
      </ul>
      {mine.hasNextPage && (
        <Button
          variant="secondary"
          className="self-center"
          loading={mine.isFetchingNextPage}
          onClick={() => void mine.fetchNextPage()}
        >
          Xem thêm đơn cũ
        </Button>
      )}
    </section>
  );
}
