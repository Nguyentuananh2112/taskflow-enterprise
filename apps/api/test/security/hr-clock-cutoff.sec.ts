import { describe, expect } from 'vitest';

import { useCompanyApi } from './harness/company';
import { addDays, nextVnAnchor, vnDateOf } from './harness/clock';
import { HR, eventsOf, hrClockEnv, withKey } from './harness/hr';
import { expectBefore, seedTrio, waitToday, vnClock } from './harness/hr-clock';
import { errorEnvelope } from './harness/http-client';
import { secCase } from './harness/suite';

// CLK-HR-03 (test-spec-hr §5b, SD-12b/12c ở tầng HTTP): GIỜ CHỐT 06:00. IN thứ Ba còn mở; ra lúc 05:59 thứ Tư ⇒
// gắn thứ Ba; ra sau 06:00 ⇒ IN hôm qua không còn mở cho OUT ⇒ 422 NOT_CHECKED_IN. Mốc thứ Tư 05:59:00 VN.
// IN của thứ Ba do HR thêm (ADJUSTMENT) vì user vừa đăng ký lúc 05:59 thứ Tư — lượt ngoài nhiệm kỳ vẫn được tính
// (SD-41); API từ chối ADJUSTMENT trước joinedAt thì ca báo rõ ở bước đó.
const ANCHOR = nextVnAnchor(3, '05:59:00');
const WED = vnDateOf(ANCHOR);
const TUE = addDays(WED, -1);
const { api, actors } = useCompanyApi(hrClockEnv(ANCHOR));
const AREA = 'Mốc 3 HR — biên giờ';

describe('Giờ chốt 06:00', () => {
  secCase(
    'CLK-HR-03',
    'IN thứ Ba còn mở: ra 05:59 thứ Tư ⇒ thuộc thứ Ba; ra sau 06:00 ⇒ 422 NOT_CHECKED_IN',
    AREA,
    async () => {
      const t = await seedTrio(actors, 'clk0600');
      for (const who of [t.mia, t.max]) {
        const adj = await actors.json('POST', HR.events(t.ws), t.olivia.accessToken, {
          userId: who.userId,
          kind: 'IN',
          date: TUE,
          time: '08:00',
          reason: 'CLK-HR-03 IN thứ Ba còn mở',
        });
        expect(adj.status, `ADJUSTMENT IN ${TUE}: ${adj.text.slice(0, 200)}`).toBe(201);
      }

      await expectBefore(actors, t.mia, t.ws, '06:00:00');
      const early = await withKey(api, 'POST', HR.checkOut(t.ws), t.mia.accessToken);
      expect(early.status, early.text.slice(0, 200)).toBe(201);
      const tue = eventsOf(
        await actors.json('GET', HR.eventsOf(t.ws, t.mia.userId, TUE), t.olivia.accessToken),
      );
      expect(tue.map((e) => e.kind).sort()).toEqual(['IN', 'OUT']);

      const past = await waitToday(actors, t.max, t.ws, (d) => vnClock(d.serverNow) >= '06:00:01');
      expect(past.date).toBe(WED);
      const late = await withKey(api, 'POST', HR.checkOut(t.ws), t.max.accessToken);
      expect(late.status, late.text.slice(0, 200)).toBe(422);
      expect(errorEnvelope(late).error).toMatchObject({
        code: 'BUSINESS_RULE_VIOLATION',
        details: { rule: 'NOT_CHECKED_IN' },
      });
      const maxTue = eventsOf(
        await actors.json('GET', HR.eventsOf(t.ws, t.max.userId, TUE), t.olivia.accessToken),
      );
      expect(maxTue.map((e) => e.kind)).toEqual(['IN']);
    },
    180_000,
  );
});
