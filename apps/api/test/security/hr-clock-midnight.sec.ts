import { describe, expect } from 'vitest';

import { Actors } from './harness/actors';
import { addDays, nextVnAnchor, vnDateOf } from './harness/clock';
import { HR, eventsOf, hrClockEnv, withKey } from './harness/hr';
import { expectBefore, seedTrio, today, waitToday } from './harness/hr-clock';
import { secCase, useApi } from './harness/suite';

// CLK-HR-02 (test-spec-hr §5b, SD-11 ở tầng HTTP): ra SAU NỬA ĐÊM, trước giờ chốt 06:00 ⇒ lượt ra thuộc ngày
// của lượt vào còn mở. Mốc thứ Ba 23:59:00 VN — process API riêng.
const ANCHOR = nextVnAnchor(2, '23:59:00');
const TUE = vnDateOf(ANCHOR);
const WED = addDays(TUE, 1);
const api = useApi(hrClockEnv(ANCHOR));
const actors = new Actors(api);
const AREA = 'Mốc 3 HR — biên giờ';

describe('Biên nửa đêm', () => {
  secCase(
    'CLK-HR-02',
    'vào 23:59 thứ Ba, ra sau 00:00 ⇒ OUT gắn thứ Ba (IN còn mở, trước 06:00); "hôm nay" thứ Tư trống',
    AREA,
    async () => {
      const t = await seedTrio(actors, 'clk0000');
      expect((await withKey(api, 'POST', HR.checkIn(t.ws), t.mia.accessToken)).status).toBe(201);
      const before = await expectBefore(actors, t.mia, t.ws, '23:59:59');
      expect(before.date).toBe(TUE);

      await waitToday(actors, t.mia, t.ws, (d) => d.date === WED);
      const out = await withKey(api, 'POST', HR.checkOut(t.ws), t.mia.accessToken);
      expect(out.status, out.text.slice(0, 200)).toBe(201);

      // Thẻ "hôm nay" (thứ Tư) không có lượt nào; lượt ra nằm ở thứ Ba.
      expect(await today(actors, t.mia, t.ws)).toMatchObject({
        date: WED,
        firstIn: null,
        lastOut: null,
      });
      const tue = eventsOf(
        await actors.json('GET', HR.eventsOf(t.ws, t.mia.userId, TUE), t.olivia.accessToken),
      );
      expect(tue.map((e) => e.kind).sort()).toEqual(['IN', 'OUT']);
      expect(tue.every((e) => e.workDate === TUE)).toBe(true);
      const wed = eventsOf(
        await actors.json('GET', HR.eventsOf(t.ws, t.mia.userId, WED), t.olivia.accessToken),
      );
      expect(wed).toHaveLength(0);
    },
    180_000,
  );
});
