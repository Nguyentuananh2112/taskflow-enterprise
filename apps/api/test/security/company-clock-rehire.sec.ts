import type { AttendanceMemberMonthDto } from '@taskflow/contracts/attendance';
import type { HireEmployeeResponse } from '@taskflow/contracts/company';
import { describe, expect } from 'vitest';

import { DAY_MS, shiftIso, useCompanyApi, type CompanyActor } from './harness/company';
import { addDays, nextVnAnchor, vnDateOf } from './harness/clock';
import { HR, hrClockEnv } from './harness/hr';
import { secCase } from './harness/suite';
import { flushRateLimitCounters } from './harness/valkey';

// CLK-HR-09 (test-spec-company §5; ADR-133 nhiệm kỳ theo NGÀY): Mia nghỉ (lastDay hôm qua ⇒ hoàn tất ngay trong
// request), restart mốc + 31 ngày trên cùng DB, nhận lại (đã có mật khẩu ⇒ không link). Bảng công HR các tháng phủ
// khoảng giữa: mọi ngày từ hôm sau lastDay tới hôm trước ngày nhận lại là NOT_EMPLOYED (không phải ABSENT) và tổng
// "Vắng" không tính chúng.
const ANCHOR = nextVnAnchor(2, '10:00:00');
const TODAY = vnDateOf(ANCHOR);
const LATER = shiftIso(ANCHOR, 31 * DAY_MS);
const REHIRED = vnDateOf(LATER);
const { api, actors } = useCompanyApi(hrClockEnv(ANCHOR));
const AREA = 'Mốc 3.5 nhân viên — nhận lại';

async function monthRow(hr: CompanyActor, month: string, userId: string) {
  let cursor: string | null = null;
  for (let page = 0; page < 20; page++) {
    const qs = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
    const res = await actors.json('GET', `${HR.month(month)}${qs}`, hr.accessToken);
    expect(res.status, res.text.slice(0, 200)).toBe(200);
    const body = res.json as {
      data: AttendanceMemberMonthDto[];
      meta: { page?: { nextCursor: string | null } };
    };
    const row = body.data.find((r) => r.user.id === userId);
    if (row) return row;
    cursor = body.meta.page?.nextCursor ?? null;
    if (!cursor) break;
  }
  throw new Error(`không thấy ${userId} trong bảng công ${month}`);
}

describe('Nhận lại sau một tháng', () => {
  secCase(
    'CLK-HR-09',
    'khoảng giữa hai nhiệm kỳ ⇒ NOT_EMPLOYED, không ABSENT; tổng Vắng không tính các ngày đó',
    AREA,
    async () => {
      const mia = await actors.createUser('clk09', { startDate: addDays(TODAY, -10) });
      const lastDay = addDays(TODAY, -1);
      const left = await actors.offboard(actors.ada, mia.userId, lastDay);
      expect(left.employee.status).toBe('LEFT');

      await api.restart({ TEST_CLOCK_ANCHOR: LATER });
      await flushRateLimitCounters();
      const back = await actors.hire(actors.ada, { email: mia.email, fullName: 'Sec clk09' });
      expect(back.status, back.text.slice(0, 300)).toBe(201);
      expect((back.json as { data: HireEmployeeResponse }).data).toMatchObject({
        employee: { userId: mia.userId, status: 'ACTIVE', startDate: REHIRED },
        accountCreated: false,
        activation: null,
      });

      const gapFrom = addDays(lastDay, 1);
      const gapTo = addDays(REHIRED, -1);
      const months = [...new Set([gapFrom.slice(0, 7), gapTo.slice(0, 7)])];
      let gapDays = 0;
      for (const month of months) {
        const row = await monthRow(actors.ada, month, mia.userId);
        for (const day of row.days) {
          if (day.date >= gapFrom && day.date <= gapTo) {
            gapDays += 1;
            expect(day.status, day.date).toBe('NOT_EMPLOYED');
          }
          if (day.date === lastDay) expect(day.status).not.toBe('NOT_EMPLOYED');
        }
        // Tổng "Vắng" chỉ đếm ngày ABSENT thật (cả ngày = 1, nửa ngày = 0,5) — không có ngày nào của khoảng giữa.
        const absent = row.days.reduce(
          (n, d) => n + (d.status === 'ABSENT' ? (d.absentHalf ? 0.5 : 1) : 0),
          0,
        );
        expect(row.totals.absentDays, month).toBe(absent);
      }
      // Từ hôm nay (ngày sau lastDay) tới hôm trước ngày nhận lại (+31 ngày) = 31 ngày.
      expect(gapDays).toBe(31);
    },
    300_000,
  );
});
