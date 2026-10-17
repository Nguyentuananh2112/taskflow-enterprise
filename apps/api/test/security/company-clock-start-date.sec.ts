import { randomUUID } from 'node:crypto';

import type { AttendanceMonthDto } from '@taskflow/contracts/attendance';
import type { HireEmployeeResponse } from '@taskflow/contracts/company';
import { describe, expect } from 'vitest';

import { useCompanyApi } from './harness/company';
import { addDays, nextVnAnchor, vnDateOf } from './harness/clock';
import { HR, hrClockEnv } from './harness/hr';
import { errorEnvelope } from './harness/http-client';
import { secCase } from './harness/suite';
import { flushRateLimitCounters } from './harness/valkey';

// CLK-HR-07 (test-spec-company §5; design §5 "Thêm nhân viên", A S3): `startDate` lùi tối đa 31 ngày, không tương lai
// (theo giờ nghiệp vụ của lịch công ty). Mốc thứ Ba 10:00 VN. Người vào từ hôm nay − 31: ngày trước `start_date` là
// NOT_EMPLOYED (không phải ABSENT), từ `start_date` trở đi thì được tính.
const ANCHOR = nextVnAnchor(2, '10:00:00');
const TODAY = vnDateOf(ANCHOR);
const { actors } = useCompanyApi(hrClockEnv(ANCHOR));
const AREA = 'Mốc 3.5 nhân viên — ngày vào làm';
const PASSWORD = 'correct-horse-battery-staple-9';

const hire = async (label: string, startDate: string) => {
  await flushRateLimitCounters();
  return actors.hire(actors.ada, {
    email: `${label}-${randomUUID()}@sec.example`,
    fullName: `Sec ${label}`,
    startDate,
  });
};

describe('Ngày vào làm (startDate)', () => {
  secCase(
    'CLK-HR-07',
    'startDate −31 ⇒ 201; −32 / ngày mai ⇒ 422 START_DATE_OUT_OF_RANGE; trước start_date ⇒ NOT_EMPLOYED',
    AREA,
    async () => {
      const start = addDays(TODAY, -31);
      for (const startDate of [addDays(TODAY, -32), addDays(TODAY, 1)]) {
        const res = await hire('clk07bad', startDate);
        expect(res.status, `${startDate}: ${res.text.slice(0, 200)}`).toBe(422);
        expect(errorEnvelope(res).error).toMatchObject({
          code: 'BUSINESS_RULE_VIOLATION',
          details: { rule: 'START_DATE_OUT_OF_RANGE' },
        });
      }

      const ok = await hire('clk07', start);
      expect(ok.status, ok.text.slice(0, 200)).toBe(201);
      const body = (ok.json as { data: HireEmployeeResponse }).data;
      expect(body.employee).toMatchObject({ status: 'PENDING_ACTIVATION', startDate: start });
      const activated = await actors.json('POST', '/auth/activate', undefined, {
        token: body.activation?.token,
        password: PASSWORD,
      });
      expect(activated.status, activated.text.slice(0, 200)).toBe(200);
      const token = (activated.json as { data: { accessToken: string } }).data.accessToken;

      const dayOf = async (date: string) => {
        const res = await actors.json('GET', HR.me(date.slice(0, 7)), token);
        expect(res.status, res.text.slice(0, 200)).toBe(200);
        const month = (res.json as { data: AttendanceMonthDto }).data;
        const day = month.days.find((d) => d.date === date);
        if (!day) throw new Error(`không có ngày ${date} trong tháng ${month.month}`);
        return day;
      };
      expect((await dayOf(addDays(start, -1))).status).toBe('NOT_EMPLOYED');
      // Từ start_date: ngày làm việc trong quá khứ không chấm ⇒ ABSENT; ngày nghỉ ⇒ OFF — không bao giờ NOT_EMPLOYED.
      for (const date of [start, addDays(start, 1), addDays(TODAY, -1)]) {
        expect((await dayOf(date)).status, date).not.toBe('NOT_EMPLOYED');
      }
    },
    180_000,
  );
});
