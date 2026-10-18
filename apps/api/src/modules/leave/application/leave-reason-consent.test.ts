import { describe, expect, it } from 'vitest';

import { createLeaveHarness, U } from '../testing/leave-harness';

const oneDay = {
  type: 'ANNUAL' as const,
  startDate: '2026-11-23',
  endDate: '2026-11-23',
  dayPart: 'FULL' as const,
};

describe('T-075: đồng ý xử lý lý do nghỉ (TL theo soát B)', () => {
  it('chưa đồng ý: có lý do ⇒ 422 LEAVE_REASON_CONSENT_REQUIRED, không ghi đơn / audit / thông báo; không lý do ⇒ gửi được', async () => {
    const h = await createLeaveHarness();
    h.reasonConsent.denied.add(U.Mia);
    await expect(
      h.leave.submit(h.as(U.Mia), { ...oneDay, reason: 'Khám bệnh' }),
    ).rejects.toMatchObject({
      statusCode: 422,
      details: { rule: 'LEAVE_REASON_CONSENT_REQUIRED' },
    });
    expect(await h.rows()).toEqual([]);
    expect([h.audit.entries.length, h.notifier.sent.length]).toEqual([0, 0]);
    const ok = await h.leave.submit(h.as(U.Mia), { ...oneDay, reason: '   ' });
    expect([ok.status, ok.reason]).toEqual(['PENDING', null]);
  });
});
