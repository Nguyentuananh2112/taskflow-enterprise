'use client';

import type { CorrectionDto } from '@taskflow/contracts/attendance';
import { useState } from 'react';

import { clockShort, dayLabel } from '@/entities/attendance';
import { CORRECTION_STATUS_LABEL, correctionAsk, useHrCorrections } from '@/entities/correction';
import { CorrectionDecision } from '@/features/hr-correction-decide';
import { cn } from '@/shared/lib/cn';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/empty-state';
import { Skeleton } from '@/shared/ui/skeleton';

type Props = Readonly<{ viewerId: string | null }>;

const FILTERS = [
  { value: 'PENDING', label: 'Chờ duyệt' },
  { value: 'ALL', label: 'Tất cả' },
] as const;

/** Giờ đang có của ngày đó — HR đối chiếu trước khi duyệt. */
function currentTimes(c: CorrectionDto): string {
  const d = c.day;
  const fmt = (iso: string | null) => (iso ? clockShort(iso, d.timezone) : 'chưa có');
  return `Hiện có: vào ${fmt(d.firstIn)} · ra ${fmt(d.lastOut)}`;
}

/**
 * Tab "Bổ sung giờ" (ADR-129): thẻ tên · ngày · "Xin giờ ra 17:45" · giờ đang có · lý do · Duyệt / Từ chối. Đơn của
 * chính mình ⇒ nút mờ "Người khác duyệt".
 */
export function HrCorrections({ viewerId }: Props) {
  const [filter, setFilter] = useState<'PENDING' | 'ALL'>('PENDING');
  const list = useHrCorrections(filter);
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <section aria-label="Đơn bổ sung giờ" className="flex flex-col gap-3">
      <div role="group" aria-label="Lọc đơn" className="flex gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            aria-pressed={filter === f.value}
            onClick={() => setFilter(f.value)}
            className={cn(
              'rounded-control px-3 py-1.5 text-sm',
              filter === f.value ? 'bg-primary text-primary-fg' : 'hover:bg-bg-subtle',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>
      {list.isPending ? (
        <div role="status" aria-busy="true" aria-label="Đang tải đơn" className="grid gap-2">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : list.isError ? (
        <EmptyState
          title="Không tải được đơn bổ sung giờ"
          action={<Button onClick={() => void list.refetch()}>Thử lại</Button>}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title={filter === 'PENDING' ? 'Không có đơn nào chờ duyệt' : 'Chưa có đơn nào'}
        />
      ) : (
        <ul aria-label="Danh sách đơn bổ sung giờ" className="flex flex-col gap-2">
          {rows.map((c) => (
            <li
              key={c.id}
              aria-label={`${c.user.fullName} — ${dayLabel(c.date)}`}
              className="flex flex-col gap-1 rounded-card border border-border bg-surface p-4 text-sm"
            >
              <p className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{c.user.fullName}</span>
                <span>· {dayLabel(c.date)}</span>
                <Badge>{CORRECTION_STATUS_LABEL[c.status]}</Badge>
              </p>
              <p className="font-semibold">{correctionAsk(c)}</p>
              <p className="text-text-muted">{currentTimes(c)}</p>
              {c.reason && <p>Lý do: {c.reason}</p>}
              {c.decisionNote && <p className="text-text-muted">Ghi chú: {c.decisionNote}</p>}
              <CorrectionDecision request={c} own={c.userId === viewerId} />
            </li>
          ))}
        </ul>
      )}
      {list.hasNextPage && (
        <Button
          variant="secondary"
          className="self-center"
          loading={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          Tải thêm
        </Button>
      )}
    </section>
  );
}
