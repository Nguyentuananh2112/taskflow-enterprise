import { describe, expect } from 'vitest';

import { useCompanyApi } from './harness/company';
import { nextVnAnchor, vnDateOf } from './harness/clock';
import { HR, adjust, hrClockEnv, withKey } from './harness/hr';
import { seedTrio, today } from './harness/hr-clock';
import { secCase } from './harness/suite';

// CLK-HR-04 (test-spec-hr §5b; test-spec-company §5): CHỦ NHẬT (S0 nghỉ). Mốc Chủ nhật 10:00 VN — process API riêng.
// Lỗi #A1 (TL chốt 18/10, A d7265257 / 9a7b98c5): chấm công ngày nghỉ ĐƯỢC ghi nhận — ngày vẫn OFF, nhưng
// inProgress / firstIn / lastOut / workedMin tính như ngày thường; KHÔNG thành ngày công (presentDays, payrollDaysOf
// không cộng; không bị tính vắng).
const ANCHOR = nextVnAnchor(0, '10:00:00');
const SUNDAY = vnDateOf(ANCHOR);
const { api, actors } = useCompanyApi(hrClockEnv(ANCHOR));
const AREA = 'Mốc 3.5 HR — biên giờ';

interface MonthDto {
  days: { date: string; status: string; workedMin: number; inProgress: boolean }[];
  totals: { presentDays: number; absentDays: number; workedMin: number };
}

async function month(token: string): Promise<MonthDto> {
  const res = await actors.json('GET', HR.me(SUNDAY.slice(0, 7)), token);
  expect(res.status, res.text.slice(0, 200)).toBe(200);
  return (res.json as { data: MonthDto }).data;
}

describe('Chủ nhật', () => {
  secCase(
    'CLK-HR-04',
    'Chủ nhật (#A1): me/today OFF, isWorkday false; chấm vào 201 ⇒ vẫn OFF nhưng inProgress true, firstIn có; chấm ra ⇒ inProgress false, workedMin > 0; KHÔNG thành ngày công (presentDays không tăng, không vắng)',
    AREA,
    async () => {
      const t = await seedTrio(actors, 'clksun');
      expect(await today(actors, t.mia)).toMatchObject({
        isWorkday: false,
        status: 'OFF',
        inProgress: false,
        firstIn: null,
      });
      const before = await month(t.mia.accessToken);

      // Mia chấm vào ⇒ OFF + "đang làm".
      const res = await withKey(api, 'POST', HR.checkIn, t.mia.accessToken);
      expect(res.status, res.text.slice(0, 200)).toBe(201);
      const after = await today(actors, t.mia);
      expect(after).toMatchObject({ status: 'OFF', isWorkday: false, inProgress: true });
      expect(after.firstIn).not.toBeNull();

      // Max: HR thêm IN 08:00 rồi Max chấm ra lúc ~10:00 ⇒ hết "đang làm", có giờ làm (~120 phút), ngày vẫn OFF.
      const inRes = await adjust(
        actors,
        t.hana,
        t.max.userId,
        'IN',
        '08:00',
        'làm Chủ nhật',
        SUNDAY,
      );
      expect(inRes.status, inRes.text.slice(0, 200)).toBe(201);
      expect(await today(actors, t.max)).toMatchObject({ status: 'OFF', inProgress: true });
      const out = await withKey(api, 'POST', HR.checkOut, t.max.accessToken);
      expect(out.status, out.text.slice(0, 200)).toBe(201);
      const done = await today(actors, t.max);
      expect(done).toMatchObject({ status: 'OFF', inProgress: false });
      expect(done.lastOut).not.toBeNull();
      const maxMonth = await month(t.max.accessToken);
      const sunday = maxMonth.days.find((d) => d.date === SUNDAY);
      expect(sunday).toMatchObject({ status: 'OFF', inProgress: false });
      expect(sunday?.workedMin ?? 0).toBeGreaterThan(60);

      // Không thành ngày công, không vắng: tổng tháng của Mia không đổi presentDays / absentDays.
      const miaAfter = await month(t.mia.accessToken);
      expect(miaAfter.totals.presentDays).toBe(before.totals.presentDays);
      expect(miaAfter.totals.absentDays).toBe(before.totals.absentDays);
      expect(maxMonth.totals.presentDays).toBe(0);
    },
  );
});
