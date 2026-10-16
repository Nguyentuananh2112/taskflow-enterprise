import {
  LeaveBalanceDto,
  LeaveBalanceRowDto,
  LeavePreviewDto,
  LeaveRequestDto,
} from '@taskflow/contracts';
import { describe, expect, it } from 'vitest';

import { createLeaveHarness, U } from '../../src/modules/leave/testing/leave-harness';

const R = '00000000-0000-7000-8000-0000000e0001';

/** DTO do use case / query dựng ra phải parse được (strict từng trường) bằng schema contracts mà web dùng. */
describe('leave DTO ↔ @taskflow/contracts', () => {
  it('LeaveRequestDto (có / không reason, decidedBy UserRef), LeaveBalanceDto, LeaveBalanceRowDto, LeavePreviewDto', async () => {
    const h = await createLeaveHarness();
    const submitted = await h.leave.submit(h.as(U.Mia), {
      type: 'ANNUAL',
      startDate: '2026-11-23',
      endDate: '2026-11-24',
      dayPart: 'FULL',
    });
    expect(LeaveRequestDto.strict().parse(submitted)).toEqual(submitted);
    await h.seed({ id: R, startDate: '2026-11-30', endDate: '2026-11-30' });
    const approved = await h.leave.approve(h.as(U.Hana), R, 1, 'ok');
    expect(LeaveRequestDto.strict().parse(approved)).toEqual(approved);

    const balance = await h.queries.myBalance(h.as(U.Mia), 2026);
    expect(LeaveBalanceDto.strict().parse(balance)).toEqual(balance);
    const row = await h.leave.adjustBalance(h.as(U.Hana), {
      userId: U.Mia,
      year: 2026,
      adjustment: -3,
    });
    expect(LeaveBalanceRowDto.strict().parse(row)).toEqual(row);
    const preview = await h.queries.preview(h.as(U.Mia), {
      type: 'SICK',
      startDate: '2026-12-01',
      endDate: '2026-12-01',
      dayPart: 'AM',
    });
    expect(LeavePreviewDto.strict().parse(preview)).toEqual(preview);
  });
});
