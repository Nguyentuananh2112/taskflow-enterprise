import { describe, expect, it } from 'vitest';

import { ExportSlots } from '../../../core/export/export-slots';
import type { SpreadsheetSheet } from '../../../core/export/xlsx/xlsx-writer';
import type { IReadSnapshot } from '../../../core/persistence/read-snapshot';
import { createLeaveHarness, U } from '../testing/leave-harness';
import {
  DEFAULT_LEAVE_EXPORT_LIMITS,
  LeaveExportUseCase,
  type LeaveExportLimits,
} from './use-cases/leave-export.use-case';

// T-057 báo cáo phép (ADR-130/131; B review; F SEC-HR-54, XL-05): thứ tự quyền → suất (429) → đếm trong snapshot
// (422 EXPORT_TOO_LARGE) → audit EXPORT → deliver; 429 / 422 / lỗi quyền KHÔNG audit; suất luôn được nhả.

type H = Awaited<ReturnType<typeof createLeaveHarness>>;

/** Snapshot giả: ghi lại thứ tự; `outside` chạy fn (uow.run của harness mở transaction riêng). */
function spySnapshot(order: string[]): IReadSnapshot {
  return {
    run: async (work) => {
      order.push('snapshot:open');
      try {
        return await work();
      } finally {
        order.push('snapshot:close');
      }
    },
    outside: (fn) => {
      order.push('outside');
      return fn();
    },
  };
}

function exporter(h: H, opts: { limits?: Partial<LeaveExportLimits>; slots?: ExportSlots } = {}) {
  const order: string[] = [];
  const slots = opts.slots ?? new ExportSlots();
  const use = new LeaveExportUseCase(h.kit, h.readModel, h.employees, {
    snapshot: spySnapshot(order),
    slots,
    limits: { ...DEFAULT_LEAVE_EXPORT_LIMITS, ...opts.limits },
  });
  return { use, order, slots };
}

const collect = async (sheets: SpreadsheetSheet[]) => {
  const out: unknown[][] = [];
  for (const s of sheets) {
    const rows: unknown[] = [];
    for await (const r of s.rows) rows.push(r);
    out.push(rows);
  }
  return out;
};

describe('LeaveExportUseCase', () => {
  it('thành công: audit EXPORT qua outside TRƯỚC deliver, trong cùng snapshot; nhả suất', async () => {
    const h = await createLeaveHarness();
    await h.seed({ id: '00000000-0000-7000-8000-0000000d0001', status: 'APPROVED' });
    const { use, order, slots } = exporter(h);
    let rows: unknown[][] = [];
    await use.run(U.Hana, { year: 2026 }, async (sheets) => {
      order.push('deliver');
      rows = await collect(sheets);
    });
    expect(order).toEqual(['snapshot:open', 'outside', 'deliver', 'snapshot:close']);
    expect(h.audit.entries.at(-1)).toMatchObject({
      action: 'EXPORT',
      after: { kind: 'leave_year', year: 2026, approved: 1 },
    });
    expect(rows[1]).toHaveLength(1); // sheet 2: 1 đơn đã duyệt
    expect(JSON.stringify(rows)).not.toContain('việc riêng'); // không lý do nghỉ
    expect(slots.running).toBe(0);
  });

  it('XL-05: quá maxEmployees / maxLeaveRows ⇒ 422 EXPORT_TOO_LARGE, không audit, không deliver, nhả suất', async () => {
    const h = await createLeaveHarness();
    await h.seed({ id: '00000000-0000-7000-8000-0000000d0002', status: 'APPROVED' });
    for (const limits of [{ maxEmployees: 1 }, { maxLeaveRows: 0 }]) {
      const { use, slots } = exporter(h, { limits });
      let delivered = false;
      await expect(
        use.run(U.Hana, { year: 2026 }, () => {
          delivered = true;
          return Promise.resolve();
        }),
      ).rejects.toMatchObject({ statusCode: 422, details: { rule: 'EXPORT_TOO_LARGE' } });
      expect(delivered).toBe(false);
      expect(slots.running).toBe(0);
    }
    expect(h.audit.entries.filter((e) => e.action === 'EXPORT')).toEqual([]);
  });

  it('SEC-HR-54: hết suất (2 export đang chạy) ⇒ 429, không mở snapshot, không audit', async () => {
    const h = await createLeaveHarness();
    const slots = new ExportSlots();
    const busy = [slots.acquire(), slots.acquire()];
    const { use, order } = exporter(h, { slots });
    await expect(use.run(U.Hana, { year: 2026 }, () => Promise.resolve())).rejects.toMatchObject({
      statusCode: 429,
    });
    expect(order).toEqual([]);
    expect(h.audit.entries.filter((e) => e.action === 'EXPORT')).toEqual([]);
    busy.forEach((release) => release());
  });

  it('không có hr:manage ⇒ 403 trước khi lấy suất; deliver lỗi giữa chừng ⇒ vẫn nhả suất (audit đã ghi — ADR-130)', async () => {
    const h = await createLeaveHarness();
    const denied = exporter(h);
    await expect(
      denied.use.run(U.Mia, { year: 2026 }, () => Promise.resolve()),
    ).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(denied.order).toEqual([]);
    const broken = exporter(h);
    await expect(
      broken.use.run(U.Hana, { year: 2026 }, () => Promise.reject(new Error('client hủy'))),
    ).rejects.toThrow('client hủy');
    expect(broken.slots.running).toBe(0);
    expect(h.audit.entries.filter((e) => e.action === 'EXPORT')).toHaveLength(1);
  });
});
