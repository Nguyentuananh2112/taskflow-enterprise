import { randomUUID } from 'node:crypto';

import { beforeAll, describe, expect } from 'vitest';

import { addDays } from './harness/clock';
import { useCompanyApi, type CompanyActor } from './harness/company';
import { HR, hrClockEnv, leaveOf, submitLeave, todayVn } from './harness/hr';
import { errorEnvelope, type RawResponse } from './harness/http-client';
import { secCase } from './harness/suite';
import { download, expectSafeWorkbook, expectXlsxHeaders, readXlsx } from './harness/xlsx';

// Mốc 5 — chính sách phép + số dư phân rã + báo cáo phép .xlsx (ADR-130/131, T-057 D; test-spec-hr-extended §4–§6):
// SEC-HR-40p (vế chính sách của SEC-HR-40), 55 · LP-01, 02, 03, 04, 10, 11, 12, 14 (vế S) · XL-01, 02, 09, 10 (vế phép) ·
// SEC-HR-52p, 54p (vế phép). Chính sách là MỘT bộ cho cả công ty ⇒ file riêng, DB riêng (§0.4); thứ tự ca trong file
// có ý nghĩa (LP-01 chạy trước mọi PUT).

// `LEAVE_CARRYOVER_INTERVAL_MS` (test-only, D) ⇒ jitter 0 ⇒ lượt đầu của job đúng 5 s sau start (mặc định jitter tới 5 phút
// áp cả lượt đầu — LP-12 cần biết chắc lượt đầu đã chạy).
const { api, actors } = useCompanyApi({ ...hrClockEnv(), LEAVE_CARRYOVER_INTERVAL_MS: '3600000' });
const AREA = 'Mốc 5 chính sách phép (T-057)';
const TODAY = todayVn();
const Y = Number(TODAY.slice(0, 4));
const START = addDays(TODAY, -5);

const P = {
  get: (year: number) => `/leave/policy?year=${String(year)}`,
  put: (year: number) => `/leave/policy/${String(year)}`,
  exportXlsx: (q: string) => `/leave/export.xlsx?${q}`,
};
const LAW = {
  annualDays: 12,
  seniorityStepYears: 5,
  seniorityBonusDays: 1,
  carryOverEnabled: false,
  carryOverMaxDays: 0,
  carryOverExpiryMonth: 3,
};

interface PolicyDto {
  year: number;
  source: 'SET' | 'INHERITED' | 'DEFAULT';
  inheritedFromYear: number | null;
  version: number;
  editable: boolean;
  annualDays: number;
}
interface BalanceDto {
  year: number;
  entitledDays: number;
  adjustmentDays: number;
  usedDays: number;
  pendingDays: number;
  remainingDays: number;
  baseDays: number;
  seniorityBonusDays: number;
  seniorityYears: number | null;
  entitledSource: string;
  missingHireDate: boolean;
  carriedOverDays: number;
  carriedFinal: boolean;
  carriedExpiresOn: string | null;
  carriedUsableDays: number;
}

let hana: CompanyActor; // nhân viên + HR_MANAGE
let mia: CompanyActor; // nhân viên

beforeAll(async () => {
  hana = await actors.createUser('lp-hana', { grants: ['HR_MANAGE'], startDate: START });
  mia = await actors.createUser('lp-mia', { startDate: START });
}, 120_000);

const call = (who: CompanyActor | undefined, method: string, path: string, body?: unknown) =>
  actors.json(method, path, who?.accessToken, body);
const expectStatus = (res: RawResponse, status: number, what: string) =>
  expect(res.status, `${what}: ${res.text.slice(0, 300)}`).toBe(status);
const errorOf = (res: RawResponse) => errorEnvelope(res).error;
const dataOf = <T>(res: RawResponse) => (res.json as { data: T }).data;
const ruleOf = (res: RawResponse) => (errorOf(res).details as { rule?: string } | null)?.rule;

async function policy(year: number): Promise<PolicyDto> {
  const res = await call(hana, 'GET', P.get(year));
  expectStatus(res, 200, `GET policy ${String(year)}`);
  return dataOf<PolicyDto>(res);
}
async function myBalance(who: CompanyActor, year = Y): Promise<BalanceDto> {
  const res = await call(who, 'GET', HR.myBalance(year));
  expectStatus(res, 200, `balances/me ${String(year)}`);
  return dataOf<BalanceDto>(res);
}
async function setHireDate(userId: string, hireDate: string) {
  const res = await call(hana, 'PUT', `/hr/employee-profiles/${userId}`, {
    hireDate,
    expectedVersion: 0,
  });
  expectStatus(res, 200, `hireDate ${hireDate}`);
}
async function approvedLeave(
  who: CompanyActor,
  startDate: string,
  endDate: string,
  type = 'ANNUAL',
) {
  const sent = await submitLeave(actors, who, { type, startDate, endDate, reason: 'nghỉ phép' });
  expectStatus(sent, 201, `xin nghỉ ${startDate}…${endDate}`);
  const leave = leaveOf(sent);
  const ok = await call(hana, 'POST', HR.leaveAction(leave.id, 'approve'), {
    expectedVersion: leave.version,
  });
  expectStatus(ok, 200, `duyệt ${startDate}`);
  return leave;
}
/** `n` ngày làm việc (T2–T7, lịch mặc định) từ `from`, không vắt năm. */
function workdaysFrom(from: string, n: number): [string, string] {
  let d = from;
  let count = 0;
  let first = '';
  for (;;) {
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (dow !== 0) {
      if (!first) first = d;
      count += 1;
      if (count === n) return [first, d];
    }
    d = addDays(d, 1);
    if (!d.startsWith(String(Y)))
      throw new Error(`không đủ ${String(n)} ngày làm việc trước hết năm`);
  }
}

describe('quyền, năm khóa, mức luật', () => {
  secCase(
    'LP-01',
    'chưa năm nào có dòng ⇒ DEFAULT = mức luật, version 0; PUT năm nay ⇒ SET; năm sau ⇒ INHERITED từ năm nay',
    AREA,
    async () => {
      const before = await policy(Y);
      expect(before).toMatchObject({
        ...LAW,
        year: Y,
        source: 'DEFAULT',
        version: 0,
        editable: true,
      });
      const put = await call(hana, 'PUT', P.put(Y), {
        ...LAW,
        annualDays: 12.5,
        expectedVersion: 0,
        reason: 'thưởng nửa ngày',
      });
      expectStatus(put, 200, 'PUT năm nay');
      expect((await policy(Y)).source).toBe('SET');
      expect(await policy(Y + 1)).toMatchObject({
        source: 'INHERITED',
        inheritedFromYear: Y,
        annualDays: 12.5,
        version: 0,
        editable: true,
      });
      expect((await policy(Y - 1)).editable).toBe(false);
      // Khôi phục mức luật cho các ca sau.
      expectStatus(
        await call(hana, 'PUT', P.put(Y), { ...LAW, expectedVersion: 1 }),
        200,
        'khôi phục',
      );
    },
  );

  secCase(
    'SEC-HR-40p',
    'nhân viên thường: GET / PUT chính sách (body sai), GET balances (HR), GET export ⇒ 403 không 400',
    AREA,
    async () => {
      for (const [method, path, body] of [
        ['GET', P.get(Y), undefined],
        ['GET', '/leave/policy?year=abc', undefined],
        ['PUT', P.put(Y), { annualDays: 1 }],
        ['GET', `/leave/balances?year=${String(Y)}`, undefined],
        ['GET', P.exportXlsx(`year=${String(Y)}`), undefined],
        ['GET', P.exportXlsx('year=sai'), undefined],
      ] as const) {
        const res = await call(mia, method, path, body);
        expectStatus(res, 403, `Mia ${method} ${path}`);
        expect(errorOf(res).code).toBe('FORBIDDEN_ACCESS');
      }
    },
  );

  secCase(
    'SEC-HR-55',
    'năm đã qua / năm sau nữa ⇒ 422 POLICY_YEAR_LOCKED; dưới mức luật / bước sai ⇒ 400; balances/me chỉ của mình (thêm userId ⇒ 400); Admin gọi balances/me ⇒ 403',
    AREA,
    async () => {
      for (const year of [Y - 1, Y + 2]) {
        const res = await call(hana, 'PUT', P.put(year), { ...LAW, expectedVersion: 0 });
        expectStatus(res, 422, `PUT ${String(year)}`);
        expect(ruleOf(res)).toBe('POLICY_YEAR_LOCKED');
      }
      for (const bad of [
        { annualDays: 11 },
        { annualDays: 12.25 },
        { annualDays: 31 },
        { seniorityStepYears: 6 },
        { seniorityBonusDays: 0.5 },
        { carryOverMaxDays: -1 },
        { carryOverExpiryMonth: 13 },
        { extra: true },
      ]) {
        const res = await call(hana, 'PUT', P.put(Y + 1), { ...LAW, ...bad, expectedVersion: 0 });
        expectStatus(res, 400, `PUT ${JSON.stringify(bad)}`);
      }
      expect((await policy(Y + 1)).source).not.toBe('SET');
      expectStatus(
        await call(mia, 'GET', `${HR.myBalance(Y)}&userId=${hana.userId}`),
        400,
        'balances/me + userId',
      );
      expect((await myBalance(mia)).year).toBe(Y);
      const ada = await call(actors.ada, 'GET', HR.myBalance(Y));
      expectStatus(ada, 403, 'Ada balances/me');
    },
  );
});

describe('LP — phép năm (hộp đen)', () => {
  secCase(
    'LP-03',
    'vào giữa năm ⇒ ĐỦ phép năm (12), không tỷ lệ; không thâm niên',
    AREA,
    async () => {
      const p = await actors.createUser('lp03', { startDate: START });
      await setHireDate(p.userId, `${String(Y)}-07-20`);
      expect(await myBalance(p)).toMatchObject({
        entitledDays: 12,
        baseDays: 12,
        seniorityBonusDays: 0,
        seniorityYears: 0,
        entitledSource: 'POLICY',
        missingHireDate: false,
      });
    },
  );

  secCase(
    'LP-02',
    'thâm niên tính tới 31/12/Y: đủ 5 năm đúng 31/12 ⇒ +1 ngay năm Y; 4 năm 364 ngày ⇒ +0',
    AREA,
    async () => {
      const five = await actors.createUser('lp02-five', { startDate: START });
      const four = await actors.createUser('lp02-four', { startDate: START });
      await setHireDate(five.userId, `${String(Y - 5)}-12-31`);
      await setHireDate(four.userId, `${String(Y - 4)}-01-01`);
      expect(await myBalance(five)).toMatchObject({
        entitledDays: 13,
        seniorityYears: 5,
        seniorityBonusDays: 1,
      });
      expect(await myBalance(four)).toMatchObject({
        entitledDays: 12,
        seniorityYears: 4,
        seniorityBonusDays: 0,
      });
    },
  );

  secCase(
    'LP-04',
    'không hireDate ⇒ annualDays + cờ missingHireDate, seniorityYears null',
    AREA,
    async () => {
      const p = await actors.createUser('lp04', { startDate: START });
      expect(await myBalance(p)).toMatchObject({
        entitledDays: 12,
        missingHireDate: true,
        seniorityYears: null,
      });
    },
  );

  secCase(
    'LP-14',
    'phân rã DTO: đủ trường, "còn lại" = entitled + adjustment − used − pending khi không có phép chuyển sang',
    AREA,
    async () => {
      const p = await actors.createUser('lp14', { startDate: START });
      await setHireDate(p.userId, `${String(Y - 6)}-03-01`);
      const [from, to] = workdaysFrom(addDays(TODAY, 7), 2);
      await approvedLeave(p, from, to);
      const [pf] = workdaysFrom(addDays(to, 3), 1);
      expectStatus(
        await submitLeave(actors, p, { type: 'ANNUAL', startDate: pf, endDate: pf, reason: 'x' }),
        201,
        'đơn chờ',
      );
      const b = await myBalance(p);
      expect(b).toMatchObject({
        entitledDays: 13,
        usedDays: 2,
        pendingDays: 1,
        carriedOverDays: 0,
        carriedUsableDays: 0,
        carriedExpiresOn: null,
      });
      expect(b.remainingDays).toBe(b.entitledDays + b.adjustmentDays - b.usedDays - b.pendingDays);
    },
  );

  secCase('LP-11', 'đơn vắt qua 2 năm ⇒ 422 LEAVE_SPANS_YEARS', AREA, async () => {
    const res = await submitLeave(actors, mia, {
      type: 'ANNUAL',
      startDate: `${String(Y)}-12-30`,
      endDate: `${String(Y + 1)}-01-02`,
      reason: 'x',
    });
    expectStatus(res, 422, 'vắt năm');
    expect(ruleOf(res)).toBe('LEAVE_SPANS_YEARS');
  });

  secCase(
    'LP-12',
    'người tạo SAU lượt đầu của job leave-carryover: GET ⇒ carriedFinal false (GET lặp không ghi); đường ghi (nộp đơn) ⇒ chụp, carriedFinal true',
    AREA,
    async () => {
      await expect
        .poll(
          () =>
            api
              .logs()
              .some((l) => l.includes('maintenance.run_done') && l.includes('leave-carryover')),
          { timeout: 30_000 },
        )
        .toBe(true);
      const p = await actors.createUser('lp12', { startDate: START });
      expect((await myBalance(p)).carriedFinal).toBe(false);
      expect((await myBalance(p)).carriedFinal).toBe(false);
      const [d] = workdaysFrom(addDays(TODAY, 10), 1);
      expectStatus(
        await submitLeave(actors, p, { type: 'ANNUAL', startDate: d, endDate: d, reason: 'x' }),
        201,
        'nộp đơn',
      );
      expect(await myBalance(p)).toMatchObject({ carriedFinal: true, carriedOverDays: 0 });
    },
    60_000,
  );

  secCase(
    'LP-10',
    'nâng phép năm lên 14, người dùng 13 ngày, hạ về 12 ⇒ negativeBalances có người đó (−1); đơn đã duyệt giữ APPROVED',
    AREA,
    async () => {
      const cur = await policy(Y);
      expectStatus(
        await call(hana, 'PUT', P.put(Y), { ...LAW, annualDays: 14, expectedVersion: cur.version }),
        200,
        'nâng 14',
      );
      const p = await actors.createUser('lp10', { startDate: START });
      const [from, to] = workdaysFrom(addDays(TODAY, 14), 13);
      const leave = await approvedLeave(p, from, to);
      const down = await call(hana, 'PUT', P.put(Y), {
        ...LAW,
        expectedVersion: cur.version + 1,
        reason: 'về mức luật',
      });
      expectStatus(down, 200, 'hạ 12');
      const negative = dataOf<{ negativeBalances: { userId: string; remainingDays: number }[] }>(
        down,
      ).negativeBalances;
      expect(negative.find((n) => n.userId === p.userId)?.remainingDays).toBe(-1);
      const mine = dataOf<{ id: string; status: string }[]>(
        await call(p, 'GET', HR.myLeaveRequests),
      );
      expect(mine.find((r) => r.id === leave.id)?.status).toBe('APPROVED');
      expect((await myBalance(p)).remainingDays).toBe(-1);
    },
  );
});

describe('báo cáo phép .xlsx', () => {
  secCase(
    'XL-09',
    '`from > to`, ngày ngoài năm, năm sai ⇒ 400; mặc định cả năm ⇒ 200, tên file nghi-phep-YYYY.xlsx',
    AREA,
    async () => {
      for (const q of [
        `year=${String(Y)}&from=${String(Y)}-05-02&to=${String(Y)}-05-01`,
        `year=${String(Y)}&from=${String(Y - 1)}-12-31`,
        'year=1999',
        'year=abc',
        `year=${String(Y)}&x=1`,
      ]) {
        const r = await download(api, hana.accessToken, P.exportXlsx(q));
        expect(r.status, `q=${q}`).toBe(400);
      }
      const ok = await download(api, hana.accessToken, P.exportXlsx(`year=${String(Y)}`));
      expectXlsxHeaders(ok, /^nghi-phep-\d{4}\.xlsx$/);
    },
  );

  secCase(
    'XL-01',
    'hai sheet: số dư của năm + "Đơn đã duyệt"; file an toàn (ADR-130); không có lý do nghỉ (SEC-HR-54p)',
    AREA,
    async () => {
      const p = await actors.createUser('xl01', { startDate: START });
      const marker = `lý-do-${randomUUID().slice(0, 8)}`;
      const [d] = workdaysFrom(addDays(TODAY, 20), 1);
      const sent = await submitLeave(actors, p, {
        type: 'ANNUAL',
        startDate: d,
        endDate: d,
        reason: marker,
      });
      const leave = leaveOf(sent);
      expectStatus(
        await call(hana, 'POST', HR.leaveAction(leave.id, 'approve'), {
          expectedVersion: leave.version,
          note: `ghi-chu-${marker}`,
        }),
        200,
        'duyệt',
      );
      const r = await download(api, hana.accessToken, P.exportXlsx(`year=${String(Y)}`));
      expectXlsxHeaders(r, /^nghi-phep-\d{4}\.xlsx$/);
      const wb = readXlsx(r.body);
      expectSafeWorkbook(wb, 'leave export');
      expect(wb.sheets).toHaveLength(2);
      expect(wb.sheets[1]?.name).toBe('Đơn đã duyệt');
      for (const [name, data] of wb.files)
        expect(data.toString('utf8'), `${name} chứa lý do`).not.toContain(marker);
    },
  );

  secCase(
    'XL-02',
    'dòng của người do ca tạo: số trong file = balances API (phép năm, đã dùng, đang chờ, còn lại)',
    AREA,
    async () => {
      const label = `xl02-${randomUUID().slice(0, 6)}`;
      const p = await actors.createUser(label, { startDate: START });
      const [from, to] = workdaysFrom(addDays(TODAY, 25), 2);
      await approvedLeave(p, from, to);
      const api0 = await myBalance(p);
      const wb = readXlsx(
        (await download(api, hana.accessToken, P.exportXlsx(`year=${String(Y)}`))).body,
      );
      const sheet = wb.sheets[0];
      if (!sheet) throw new Error('thiếu sheet số dư');
      const header = sheet.rows[0] ?? [];
      const col = (h: string) => header.indexOf(h);
      const line = sheet.rows.find((r) => r[0] === `Sec ${label}`);
      expect(line, 'không thấy dòng của người tạo trong file').toBeDefined();
      expect(line?.[col('Phép năm')]).toBe(api0.entitledDays);
      expect(line?.[col('Đã dùng')]).toBe(api0.usedDays);
      expect(line?.[col('Đang chờ')]).toBe(api0.pendingDays);
      expect(line?.[col('Còn lại')]).toBe(api0.remainingDays);
    },
  );

  secCase(
    'XL-10',
    'mỗi lần tải thành công đúng 1 audit EXPORT; 400 không audit',
    AREA,
    async () => {
      const count = async () => {
        const res = await call(actors.ada, 'GET', `${HR.auditLogs}?limit=100`);
        return dataOf<{ action: string }[]>(res).filter((a) => a.action === 'EXPORT').length;
      };
      const before = await count();
      expect((await download(api, hana.accessToken, P.exportXlsx('year=abc'))).status).toBe(400);
      expect(await count()).toBe(before);
      expect(
        (await download(api, hana.accessToken, P.exportXlsx(`year=${String(Y)}`))).status,
      ).toBe(200);
      expect(await count()).toBe(before + 1);
    },
  );
});
