import { describe, expect, it } from 'vitest';

import { createPayrollHarness, KAI, MAX, MIA } from '../../testing/payroll-harness';
import { PayrollRunsUseCases } from './payroll-runs.use-cases';
import { PayrollReminderUseCase, reminderRefId } from './payroll-reminder.use-case';
import { PublishPayrollUseCase } from './publish-payroll.use-case';

// payroll.md §4 bước 5 + test-spec CLK-PAY-02…04 (tầng A, T-049): nhắc từ ngày 5 (giờ lịch công ty), mỗi ngày một lần,
// quá ngày 10 vẫn nhắc, dừng khi bảng tháng trước đã phát hành; người nhận = payroll:manage hiện tại.
const vn = (local: string) => new Date(`${local.replace(' ', 'T')}:00+07:00`);

describe('PayrollReminderUseCase', () => {
  it('ngày 4 ⇒ chưa nhắc; ngày 5 ⇒ nhắc kỳ tháng trước tới payroll (hệ thống, không actor); cùng ngày lần 2 ⇒ không lặp', async () => {
    const h = createPayrollHarness(vn('2026-12-04 23:59').toISOString());
    const reminder = new PayrollReminderUseCase(h.deps);
    expect(await reminder.run()).toBe(false);
    h.clock.set(vn('2026-12-05 00:01'));
    expect(await reminder.run()).toBe(true);
    expect(h.sent).toEqual([
      {
        type: 'PAYROLL_REMINDER',
        refId: reminderRefId('2026-12-05'),
        actorId: null,
        recipient: { kind: 'payroll' },
      },
    ]);
    expect(await reminder.run()).toBe(false);
    expect(h.store.locks.at(-1)).toBe('taskflow:payroll:reminder:2026-11');
  });

  it('quá ngày 10 vẫn nhắc mỗi ngày (refId theo ngày); bảng NHÁP vẫn nhắc; đã PUBLISHED ⇒ thôi', async () => {
    const h = createPayrollHarness(vn('2026-12-11 09:00').toISOString());
    const reminder = new PayrollReminderUseCase(h.deps);
    for (const u of [KAI, MIA, MAX]) await h.profile(u, '2026-01', 10_000_000);
    h.hireDates.set(MAX, '2025-01-01');
    await new PayrollRunsUseCases(h.deps).create(KAI, '2026-11');
    expect(await reminder.run()).toBe(true);
    h.clock.set(vn('2026-12-12 09:00'));
    expect(await reminder.run()).toBe(true);
    expect(
      new Set(h.sent.filter((s) => s.type === 'PAYROLL_REMINDER').map((s) => s.refId)).size,
    ).toBe(2);
    await new PublishPayrollUseCase(h.deps).execute(KAI, '2026-11');
    h.clock.set(vn('2026-12-13 09:00'));
    expect(await reminder.run()).toBe(false);
  });

  it('refId là UUID hợp lệ, khác nhau theo ngày, qua năm (01/2027 nhắc kỳ 2026-12)', async () => {
    expect(reminderRefId('2026-12-05')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(reminderRefId('2026-12-05')).not.toBe(reminderRefId('2026-12-06'));
    const h = createPayrollHarness(vn('2027-01-07 09:00').toISOString());
    await new PayrollReminderUseCase(h.deps).run();
    expect(h.store.locks.at(-1)).toBe('taskflow:payroll:reminder:2026-12');
  });
});
