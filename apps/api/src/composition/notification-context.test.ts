import { describe, expect, it } from 'vitest';

import { notificationContextFrom } from './notification-adapters';

const REQ = '0000aaaa-0000-7000-8000-00000000aaaa';

describe('notificationContextFrom (T-040b L2): tên qua reader user, đơn qua reader của leave', () => {
  it('actorNames lấy fullName từ findRefs; id không có ⇒ không có trong Map; leaveSummaries ủy quyền nguyên vẹn', async () => {
    const asked: unknown[] = [];
    const ctx = notificationContextFrom({
      users: {
        findRefs: (ids) => {
          asked.push(ids);
          return Promise.resolve(new Map([['u1', { id: 'u1', fullName: 'Mia' }]]));
        },
      },
      leaves: {
        leaveSummaries: (refIds) =>
          Promise.resolve(
            new Map(
              refIds.map((id) => [
                id,
                { type: 'SICK', startDate: '2026-11-18', endDate: '2026-11-18' },
              ]),
            ),
          ),
      },
    });
    expect(await ctx.actorNames(['u1', 'ghost'])).toEqual(new Map([['u1', 'Mia']]));
    expect(asked).toEqual([['u1', 'ghost']]);
    expect(await ctx.leaveSummaries([REQ])).toEqual(
      new Map([[REQ, { type: 'SICK', startDate: '2026-11-18', endDate: '2026-11-18' }]]),
    );
  });
});
