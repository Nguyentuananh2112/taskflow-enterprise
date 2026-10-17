import { randomUUID } from 'node:crypto';

import type { HireEmployeeResponse } from '@taskflow/contracts/company';
import { describe, expect } from 'vitest';

import { useCompanyApi } from './harness/company';
import { HR, hrClockEnv } from './harness/hr';
import { errorEnvelope } from './harness/http-client';
import { secCase } from './harness/suite';
import { flushRateLimitCounters } from './harness/valkey';

// CLK-HR-08 (test-spec-company §5; ADR-120/135): lịch công ty múi `Europe/Berlin`, NGÀY ĐỔI GIỜ (Chủ nhật cuối tháng 3 /
// tháng 10). `start_date` mặc định = "hôm nay" THEO BERLIN (lúc 20:00 Berlin thì VN đã sang ngày sau);
// `access_until` = 06:00 BERLIN ngày sau ngày làm cuối, đúng offset SAU đổi giờ. Kiểm hộp đen bằng restart mốc tiến:
// 60 s trước 06:00 Berlin ⇒ route công ty 200; 30 s sau ⇒ 401 SESSION_REVOKED.
const TZ = 'Europe/Berlin';
const AREA = 'Mốc 3.5 nhân viên — múi giờ lịch công ty';
const PASSWORD = 'correct-horse-battery-staple-9';

const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});
/** `YYYY-MM-DD HH:mm` giờ Berlin của một thời điểm. */
const berlinOf = (ms: number) => {
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
};
/** Thời điểm UTC của `date hh:mm` giờ Berlin (offset +1 hoặc +2). */
const berlinInstant = (date: string, hm: string): number => {
  for (const offsetH of [1, 2]) {
    const ms = Date.parse(`${date}T${hm}:00.000Z`) - offsetH * 3_600_000;
    if (berlinOf(ms) === `${date} ${hm}`) return ms;
  }
  throw new Error(`không có ${date} ${hm} ở ${TZ}`);
};
const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
/** Chủ nhật cuối tháng 3 hoặc tháng 10 gần nhất, cách hôm nay ≥ 2 ngày (mốc luôn ở tương lai). */
function nextDstSunday(from = Date.now()): string {
  const min = new Date(from + 2 * 86_400_000).toISOString().slice(0, 10);
  for (let y = new Date(from).getUTCFullYear(); ; y++) {
    for (const month of [3, 10]) {
      const last = new Date(Date.UTC(y, month, 0)); // ngày cuối tháng
      last.setUTCDate(last.getUTCDate() - last.getUTCDay());
      const date = last.toISOString().slice(0, 10);
      if (date >= min) return date;
    }
  }
}

const DST_DAY = nextDstSunday();
// Bước 1 (10:00 Berlin): VN cùng ngày ⇒ lịch hiệu lực từ DST_DAY không bị coi là quá khứ khi còn lịch mặc định (VN).
const ANCHOR = new Date(berlinInstant(DST_DAY, '10:00')).toISOString();
const { api, actors } = useCompanyApi(hrClockEnv(ANCHOR));

describe('Lịch công ty múi Berlin, ngày đổi giờ', () => {
  secCase(
    'CLK-HR-08',
    'start_date = ngày Berlin (VN đã sang ngày sau); access_until = 06:00 Berlin hôm sau, đúng offset sau đổi giờ',
    AREA,
    async () => {
      const schedule = await actors.json('POST', HR.schedules, actors.ada.accessToken, {
        effectiveFrom: DST_DAY,
        timezone: TZ,
        workdays: 0b0011111,
        startMin: 480,
        endMin: 1020,
        breakStartMin: 720,
        breakEndMin: 780,
        graceMin: 0,
      });
      expect(schedule.status, schedule.text.slice(0, 300)).toBe(201);

      // Bước 2: 20:00 Berlin = 02:00 / 03:00 VN ngày sau ⇒ "hôm nay" khác nhau giữa hai múi.
      const evening = berlinInstant(DST_DAY, '20:00');
      expect(new Date(evening + 7 * 3_600_000).toISOString().slice(0, 10)).toBe(
        addDays(DST_DAY, 1),
      );
      await api.restart({ TEST_CLOCK_ANCHOR: new Date(evening).toISOString() });

      await flushRateLimitCounters();
      const email = `clk08-${randomUUID()}@sec.example`;
      const hired = await actors.hire(actors.ada, { email, fullName: 'Sec clk08' });
      expect(hired.status, hired.text.slice(0, 300)).toBe(201);
      const body = (hired.json as { data: HireEmployeeResponse }).data;
      expect(body.employee.startDate).toBe(DST_DAY);
      const mia = await actors.activate({
        userId: body.employee.userId,
        email,
        token: body.activation?.token ?? '',
      });

      const offboard = await actors.offboardRaw(actors.ada, mia.userId, DST_DAY);
      expect(offboard.status, offboard.text.slice(0, 300)).toBe(200);
      expect(
        (offboard.json as { data: { employee: { status: string } } }).data.employee.status,
      ).toBe('OFFBOARDING');

      // 06:00 Berlin ngày sau — offset của NGÀY SAU đổi giờ (tháng 10 ⇒ +1, tháng 3 ⇒ +2).
      const accessUntil = berlinInstant(addDays(DST_DAY, 1), '06:00');
      const offsetAfter = DST_DAY.slice(5, 7) === '10' ? 1 : 2;
      expect(accessUntil).toBe(
        Date.parse(`${addDays(DST_DAY, 1)}T06:00:00.000Z`) - offsetAfter * 3_600_000,
      );

      await api.restart({ TEST_CLOCK_ANCHOR: new Date(accessUntil - 60_000).toISOString() });
      const before = await actors.json('GET', '/auth/me', mia.accessToken);
      expect(before.status, before.text.slice(0, 200)).toBe(200);

      await api.restart({ TEST_CLOCK_ANCHOR: new Date(accessUntil + 30_000).toISOString() });
      const after = await actors.json('GET', '/auth/me', mia.accessToken);
      expect(after.status, after.text.slice(0, 200)).toBe(401);
      // Job hoàn tất có thể đã chạy (phiên bị thu hồi ⇒ UNAUTHORIZED) hoặc chưa (⇒ SESSION_REVOKED) — cả hai đều chặn.
      expect(['SESSION_REVOKED', 'UNAUTHORIZED']).toContain(errorEnvelope(after).error.code);
      const login = await actors.json('POST', '/auth/login', undefined, {
        email,
        password: PASSWORD,
      });
      expect(login.status).toBe(401);
    },
    300_000,
  );
});
