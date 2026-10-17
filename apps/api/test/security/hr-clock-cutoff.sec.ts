import { describe, expect } from 'vitest';

import { useCompanyApi } from './harness/company';
import { addDays, nextVnAnchor, vnDateOf } from './harness/clock';
import { HR, adjust, eventsOf, hrClockEnv, withKey } from './harness/hr';
import { expectBefore, seedTrio, waitToday, vnClock } from './harness/hr-clock';
import { errorEnvelope } from './harness/http-client';
import { secCase } from './harness/suite';

// CLK-HR-03 (test-spec-hr §5b, SD-12b/12c ở tầng HTTP; test-spec-company §5): GIỜ CHỐT 06:00. IN thứ Ba còn mở; ra
// lúc 05:59 thứ Tư ⇒ gắn thứ Ba; ra sau 06:00 ⇒ IN hôm qua không còn mở cho OUT ⇒ 422 NOT_CHECKED_IN. Mốc thứ Tư
// 05:59:00 VN. IN của thứ Ba do HANA (HR) thêm (ADJUSTMENT) — Mốc 3.5 không còn OWNER tự thêm; nhiệm kỳ của Mia/Max
// bắt đầu từ thứ Ba (`startDate`) để lượt thứ Ba nằm trong nhiệm kỳ.
const ANCHOR = nextVnAnchor(3, '05:59:00');
const WED = vnDateOf(ANCHOR);
const TUE = addDays(WED, -1);
const { api, actors } = useCompanyApi(hrClockEnv(ANCHOR));
const AREA = 'Mốc 3.5 HR — biên giờ';

describe('Giờ chốt 06:00', () => {
  secCase(
    'CLK-HR-03',
    'IN thứ Ba còn mở: ra 05:59 thứ Tư ⇒ thuộc thứ Ba; ra sau 06:00 ⇒ 422 NOT_CHECKED_IN',
    AREA,
    async () => {
      const t = await seedTrio(actors, 'clk0600', TUE);
      for (const who of [t.mia, t.max]) {
        const adj = await adjust(
          actors,
          t.hana,
          who.userId,
          'IN',
          '08:00',
          'CLK-HR-03 IN thứ Ba còn mở',
          TUE,
        );
        expect(adj.status, `ADJUSTMENT IN ${TUE}: ${adj.text.slice(0, 200)}`).toBe(201);
      }

      await expectBefore(actors, t.mia, '06:00:00');
      const early = await withKey(api, 'POST', HR.checkOut, t.mia.accessToken);
      expect(early.status, early.text.slice(0, 200)).toBe(201);
      const tue = eventsOf(
        await actors.json('GET', HR.eventsOf(t.mia.userId, TUE), t.hana.accessToken),
      );
      expect(tue.map((e) => e.kind).sort()).toEqual(['IN', 'OUT']);

      const past = await waitToday(actors, t.max, (d) => vnClock(d.serverNow) >= '06:00:01');
      expect(past.date).toBe(WED);
      const late = await withKey(api, 'POST', HR.checkOut, t.max.accessToken);
      expect(late.status, late.text.slice(0, 200)).toBe(422);
      expect(errorEnvelope(late).error).toMatchObject({
        code: 'BUSINESS_RULE_VIOLATION',
        details: { rule: 'NOT_CHECKED_IN' },
      });
      const maxTue = eventsOf(
        await actors.json('GET', HR.eventsOf(t.max.userId, TUE), t.hana.accessToken),
      );
      expect(maxTue.map((e) => e.kind)).toEqual(['IN']);
    },
    180_000,
  );
});
