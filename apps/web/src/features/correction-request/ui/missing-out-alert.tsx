'use client';

import Link from 'next/link';

import { shiftMonth, useAttendanceMonth } from '@/entities/attendance';
import { useMyCorrections } from '@/entities/correction';
import { Button } from '@/shared/ui/button';

import { correctionWindowStart } from '../lib/correction-kind';

const dm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

type Props = Readonly<{
  /** Hôm nay theo SERVER. */
  today: string;
  /** Trên `/attendance`: mở chi tiết ngày tại chỗ. Không truyền ⇒ link sang `/attendance?month=…&day=…`. */
  onOpenDay?: (date: string) => void;
}>;

/**
 * Cảnh báo quên chấm ra (payroll.md §5.1 + ADR-129): ngày MISSING_OUT trong cửa sổ đơn bổ sung (tháng này + tháng
 * trước) chưa có đơn ⇒ "Ngày dd/mm chưa chấm ra — chưa được tính công" + "Xin bổ sung giờ ra". Đã gửi đơn ⇒ không nhắc
 * lại. Không có ngày nào ⇒ không chiếm chỗ.
 */
export function MissingOutAlert({ today, onOpenDay }: Props) {
  const month = today.slice(0, 7);
  const prev = shiftMonth(month, -1);
  const cur = useAttendanceMonth(month, true).data;
  const before = useAttendanceMonth(prev, true).data;
  const mine = useMyCorrections(true).data;
  const asked = new Set(
    (mine?.pages.flatMap((p) => p.data) ?? [])
      .filter((c) => c.kind === 'OUT' && (c.status === 'PENDING' || c.status === 'APPROVED'))
      .map((c) => c.date),
  );
  const from = correctionWindowStart(today);
  const days = [...(before?.days ?? []), ...(cur?.days ?? [])]
    .filter(
      (d) => d.status === 'MISSING_OUT' && d.date >= from && d.date <= today && !asked.has(d.date),
    )
    .map((d) => d.date);
  if (!mine || days.length === 0) return null;
  return (
    <section
      aria-labelledby="missing-out"
      className="flex flex-col gap-2 rounded-card border border-warning bg-surface p-4 text-sm"
    >
      <h2 id="missing-out" className="font-semibold">
        Chưa chấm ra
      </h2>
      <ul className="flex flex-col gap-2">
        {days.map((date) => (
          <li key={date} className="flex flex-wrap items-center justify-between gap-2">
            <span>Ngày {dm(date)} chưa chấm ra — chưa được tính công.</span>
            {onOpenDay ? (
              <Button size="sm" variant="secondary" onClick={() => onOpenDay(date)}>
                Xin bổ sung giờ ra ({dm(date)})
              </Button>
            ) : (
              <Link
                href={`/attendance?month=${date.slice(0, 7)}&day=${date}`}
                className="rounded-control border border-border px-3 py-1.5 hover:bg-bg-subtle"
              >
                Xin bổ sung giờ ra ({dm(date)})
              </Link>
            )}
          </li>
        ))}
      </ul>
      <p className="text-xs text-text-muted">Gửi trước ngày 5 để kịp tính lương tháng.</p>
    </section>
  );
}
