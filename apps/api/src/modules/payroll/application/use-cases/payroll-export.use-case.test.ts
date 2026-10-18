import { describe, expect, it } from 'vitest';

import { DEFAULT_EXPORT_LIMITS, type ExportLimits } from '../../../../core/export/export-limits';
import { ExportSlots } from '../../../../core/export/export-slots';
import type { SpreadsheetSheet } from '../../../../core/export/xlsx/xlsx-writer';
import type { IReadSnapshot } from '../../../../core/persistence/read-snapshot';
import { createPayrollHarness, KAI, MAX, MIA, OLIVIA } from '../../testing/payroll-harness';
import { PayrollExportUseCase } from './payroll-export.use-case';
import { PayrollRunsUseCases } from './payroll-runs.use-cases';
import { PayslipEditsUseCases } from './payslip-edits.use-cases';

// T-049 xuất bảng lương .xlsx (payroll.md §5.2/§6, ADR-130; B: thứ tự export chung): quyền → suất (429) → snapshot
// { 404 / đếm (422 EXPORT_TOO_LARGE) → audit PAYROLL_EXPORT (outside) → send }; 403 / 404 / 422 / 429 KHÔNG audit; suất
// luôn được nhả. Ô tiền là số nguyên; ngày vào công ty là ô ngày; không lý do sửa công.

type H = ReturnType<typeof createPayrollHarness>;

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

function exporter(h: H, opts: { limits?: Partial<ExportLimits>; slots?: ExportSlots } = {}) {
  const order: string[] = [];
  const slots = opts.slots ?? new ExportSlots();
  const use = new PayrollExportUseCase({
    ...h.deps,
    snapshot: spySnapshot(order),
    slots,
    limits: { ...DEFAULT_EXPORT_LIMITS, ...opts.limits },
  });
  return { use, order, slots };
}

const collect = async (sheets: readonly SpreadsheetSheet[]) => {
  const out: unknown[][][] = [];
  for (const s of sheets) {
    const rows: unknown[][] = [];
    for await (const r of s.rows) rows.push([...r]);
    out.push(rows);
  }
  return out;
};

async function draft() {
  const h = createPayrollHarness();
  await h.profile(KAI, '2026-01', 12_000_000);
  await h.profile(MIA, '2026-01', 10_000_000);
  await h.profile(MAX, '2026-01', 8_000_000);
  h.hireDates.set(MAX, '2026-02-01');
  await new PayrollRunsUseCases(h.deps).create(OLIVIA, '2026-11');
  return h;
}

describe('PayrollExportUseCase', () => {
  it('thành công: audit PAYROLL_EXPORT qua outside TRƯỚC send, cùng snapshot; ô tiền số nguyên, ngày là ô ngày; nhả suất', async () => {
    const h = await draft();
    await new PayslipEditsUseCases(h.deps).put(KAI, {
      period: '2026-11',
      userId: MIA,
      expectedLockVersion: 1,
      lines: [
        { section: 'BONUS', label: '=HYPERLINK("x")', amount: 2_000_000 },
        { section: 'DEDUCTION', label: 'BHXH', amount: 1_050_000 },
      ],
      note: null,
      overrideHalfDays: 49,
      overrideReason: 'Ốm nửa ngày',
    });
    const { use, order, slots } = exporter(h);
    let file = '';
    let names: string[] = [];
    let rows: unknown[][][] = [];
    await use.run(KAI, '2026-11', async (filename, sheets) => {
      order.push('send');
      file = filename;
      names = sheets.map((s) => s.name);
      rows = await collect(sheets);
    });
    expect(order).toEqual(['snapshot:open', 'outside', 'send', 'snapshot:close']);
    expect(slots.running).toBe(0);
    expect(file).toBe('bang-luong-2026-11.xlsx');
    expect(names).toEqual(['Bảng lương 2026-11 (nháp)', 'Các khoản']);
    const run = await h.store.findRun('2026-11');
    expect(h.audit.at(-1)).toEqual({
      action: 'PAYROLL_EXPORT',
      actorId: KAI,
      after: {
        report: 'PAYROLL_MONTH',
        period: '2026-11',
        status: 'DRAFT',
        rows: 3,
        format: 'xlsx',
      },
    });
    expect(run).not.toBeNull();
    // Sắp theo tên: Kai, Max, Mia.
    expect(rows[0]!.map((r) => r[0])).toEqual(['Kai', 'Max', 'Mia']);
    const mia = rows[0]![2]!;
    const slip = await h.store.findCurrentPayslip(run!.id, MIA);
    expect(mia).toEqual([
      'Mia',
      'L1',
      { date: '2023-11-30' },
      slip!.seniorityYears,
      10_000_000,
      25,
      24.5,
      slip!.salaryByDays,
      slip!.seniorityAllowance,
      slip!.incomeTotal,
      2_000_000,
      1_050_000,
      slip!.netPay,
      1,
      null,
      null,
    ]);
    for (const cell of mia.slice(7, 13)) expect(Number.isSafeInteger(cell)).toBe(true);
    // Không lý do sửa công ở bất kỳ ô nào.
    expect(JSON.stringify(rows)).not.toContain('Ốm nửa ngày');
    // Chỉ Mia có dòng khoản; nhãn gõ tay giữ nguyên văn (writer tự quotePrefix).
    expect(rows[1]).toEqual([
      ['Mia', 'Thưởng', '=HYPERLINK("x")', 2_000_000],
      ['Mia', 'Giảm trừ', 'BHXH', 1_050_000],
    ]);
  });

  it('chưa có bảng ⇒ 404 payroll_run, không audit; suất được nhả', async () => {
    const h = createPayrollHarness();
    const { use, slots } = exporter(h);
    await expect(use.run(KAI, '2026-11', () => Promise.resolve())).rejects.toMatchObject({
      statusCode: 404,
      details: { resource: 'payroll_run' },
    });
    expect(h.audit).toEqual([]);
    expect(slots.running).toBe(0);
  });

  it('quá trần người ⇒ 422 EXPORT_TOO_LARGE trước send, không audit (thông báo không có số người)', async () => {
    const h = await draft();
    const { use, slots } = exporter(h, { limits: { maxEmployees: 2 } });
    let sent = false;
    const err: unknown = await use
      .run(KAI, '2026-11', () => {
        sent = true;
        return Promise.resolve();
      })
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ statusCode: 422, details: { rule: 'EXPORT_TOO_LARGE' } });
    expect(sent).toBe(false);
    expect(h.audit.filter((a) => a.action === 'PAYROLL_EXPORT')).toEqual([]);
    expect(slots.running).toBe(0);
  });

  it('không payroll:manage ⇒ 403 trước khi giữ suất; hết suất ⇒ 429, không audit', async () => {
    const h = await draft();
    const full = new ExportSlots(0);
    await expect(
      exporter(h).use.run(MIA, '2026-11', () => Promise.resolve()),
    ).rejects.toMatchObject({
      statusCode: 403,
    });
    await expect(
      exporter(h, { slots: full }).use.run(KAI, '2026-11', () => Promise.resolve()),
    ).rejects.toMatchObject({ statusCode: 429 });
    expect(h.audit.filter((a) => a.action === 'PAYROLL_EXPORT')).toEqual([]);
  });

  it('send ném lỗi giữa chừng ⇒ audit vẫn còn (ADR-130), suất vẫn nhả', async () => {
    const h = await draft();
    const { use, slots } = exporter(h);
    await expect(
      use.run(KAI, '2026-11', () => Promise.reject(new Error('client đóng kết nối'))),
    ).rejects.toThrow('client đóng kết nối');
    expect(h.audit.at(-1)?.action).toBe('PAYROLL_EXPORT');
    expect(slots.running).toBe(0);
  });
});
