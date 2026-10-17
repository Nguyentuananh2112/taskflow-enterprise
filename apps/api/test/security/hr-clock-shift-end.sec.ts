import { describe, expect } from 'vitest';

import { Actors } from './harness/actors';
import { nextVnAnchor } from './harness/clock';
import { HR, hrClockEnv, withKey } from './harness/hr';
import { expectBefore, seedTrio, today, waitToday } from './harness/hr-clock';
import { secCase, useApi } from './harness/suite';

// CLK-HR-01 (test-spec-hr §5b): biên KẾT THÚC CA 17:30 (S0). Mốc thứ Ba 17:29:30 VN — process API riêng.
// summarizeDay so `now > end` theo PHÚT ⇒ cả phút 17:30 vẫn là trong ca; trạng thái đổi lúc 17:31:00 (cổng gộp
// 2026-10-17: mốc 17:29:00 làm ca chạy 120 s, sát giới hạn chờ) ⇒ mốc 17:29:30, chờ tối đa 150 s.
const ANCHOR = nextVnAnchor(2, '17:29:30');
const api = useApi(hrClockEnv(ANCHOR));
const actors = new Actors(api);
const AREA = 'Mốc 3 HR — biên giờ';

describe('Biên 17:30', () => {
  secCase(
    'CLK-HR-01',
    'qua 17:30 (hết ca S0): đã vào chưa ra ⇒ PRESENT/đang làm → MISSING_OUT; chưa vào ⇒ PENDING → ABSENT',
    AREA,
    async () => {
      const t = await seedTrio(actors, 'clk1730');
      const punched = await withKey(api, 'POST', HR.checkIn(t.ws), t.mia.accessToken);
      expect(punched.status, punched.text.slice(0, 200)).toBe(201);

      const miaBefore = await expectBefore(actors, t.mia, t.ws, '17:30:00');
      expect(miaBefore).toMatchObject({ isWorkday: true, status: 'PRESENT', inProgress: true });
      expect((await today(actors, t.max, t.ws)).status).toBe('PENDING');

      const miaAfter = await waitToday(actors, t.mia, t.ws, (d) => d.status !== 'PRESENT', 150_000);
      expect(miaAfter).toMatchObject({
        status: 'MISSING_OUT',
        inProgress: false,
        date: miaBefore.date,
      });
      expect(miaAfter.firstIn).toBe(miaBefore.firstIn);
      expect(await today(actors, t.max, t.ws)).toMatchObject({ status: 'ABSENT', firstIn: null });
    },
    240_000,
  );
});
