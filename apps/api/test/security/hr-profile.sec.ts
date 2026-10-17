import { randomUUID } from 'node:crypto';

import { beforeAll, describe, expect } from 'vitest';

import { addDays } from './harness/clock';
import { useCompanyApi, type CompanyActor } from './harness/company';
import { HR, hrClockEnv, todayVn } from './harness/hr';
import { errorEnvelope, type RawResponse } from './harness/http-client';
import { secCase } from './harness/suite';

// Mốc 5 — hồ sơ nhân viên (ADR-128, T-054 B; test-spec-hr-extended §2, §6): SEC-HR-40 (vế hồ sơ), 41, 42, 43, 45 (vế
// hồ sơ), 46, 47 · EP-01…06, 08, 11, 13 (vế S). Một công ty / DB / file (§0.4): mỗi ca tự tạo người, không đếm tuyệt
// đối danh sách, thông báo theo delta `refId`. EP-09 / EP-12 (`negativeBalances`, `ADJUSTMENT_DAYS_REVIEW`) chờ T-057.

const { api, actors } = useCompanyApi(hrClockEnv());
const AREA = 'Mốc 5 hồ sơ nhân viên (T-054)';
const TODAY = todayVn();
const START = addDays(TODAY, -5);
const YESTERDAY = addDays(TODAY, -1);

const PROFILE = {
  me: '/hr/employee-profiles/me',
  departments: '/hr/employee-profiles/departments',
  of: (userId: string) => `/hr/employee-profiles/${userId}`,
};

interface ProfileDto {
  userId: string;
  fullName: string;
  status: string;
  hireDate: string | null;
  department: string | null;
  jobTitle: string | null;
  workPhone: string | null;
  version: number;
  seniority: { years: number; months: number } | null;
  missingHireDate: boolean;
}
interface PutResult {
  profile: ProfileDto;
  negativeBalances: unknown[];
  warnings: string[];
}
interface AuditRow {
  action: string;
  targetUserId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

let hana: CompanyActor; // nhân viên + HR_MANAGE
let hugo: CompanyActor; // nhân viên + HR_MANAGE (HR thứ hai)
let mia: CompanyActor; // nhân viên
let max: CompanyActor; // nhân viên

beforeAll(async () => {
  hana = await actors.createUser('ep-hana', { grants: ['HR_MANAGE'], startDate: START });
  hugo = await actors.createUser('ep-hugo', { grants: ['HR_MANAGE'], startDate: START });
  mia = await actors.createUser('ep-mia', { startDate: START });
  max = await actors.createUser('ep-max', { startDate: START });
}, 120_000);

const call = (who: CompanyActor | undefined, method: string, path: string, body?: unknown) =>
  actors.json(method, path, who?.accessToken, body);
const expectStatus = (res: RawResponse, status: number, what: string) =>
  expect(res.status, `${what}: ${res.text.slice(0, 300)}`).toBe(status);
const errorOf = (res: RawResponse) => errorEnvelope(res).error;
const dataOf = <T>(res: RawResponse) => (res.json as { data: T }).data;

async function getProfile(by: CompanyActor, userId: string): Promise<ProfileDto> {
  const res = await call(by, 'GET', PROFILE.of(userId));
  expectStatus(res, 200, `GET hồ sơ ${userId}`);
  return dataOf<ProfileDto>(res);
}

async function putProfile(
  by: CompanyActor,
  userId: string,
  body: Record<string, unknown>,
  want = 200,
): Promise<RawResponse> {
  const res = await call(by, 'PUT', PROFILE.of(userId), body);
  expectStatus(res, want, `PUT hồ sơ ${userId} ${JSON.stringify(body).slice(0, 120)}`);
  return res;
}

/** Audit chỉ Admin đọc (ADR-136). Trang đầu đủ: mới nhất trước, mỗi file một DB. */
async function auditOf(targetUserId: string, action = 'PROFILE_SET'): Promise<AuditRow[]> {
  const res = await actors.json('GET', `${HR.auditLogs}?limit=100`, actors.ada.accessToken);
  expectStatus(res, 200, 'GET audit');
  return dataOf<AuditRow[]>(res).filter(
    (r) => r.action === action && r.targetUserId === targetUserId,
  );
}

/** Nhân viên đã nghỉ (lastDay = hôm qua ⇒ hoàn tất ngay trong request), có hồ sơ `hireDate`. */
async function departed(label: string, hireDate: string): Promise<CompanyActor> {
  const quinn = await actors.createUser(label, { startDate: START });
  await putProfile(hana, quinn.userId, { hireDate, department: 'Kho', expectedVersion: 0 });
  expect((await actors.offboard(hana, quinn.userId, YESTERDAY)).employee.status).toBe('LEFT');
  return quinn;
}

describe('quyền và thứ tự lỗi', () => {
  secCase(
    'SEC-HR-40',
    'nhân viên thường gọi route hồ sơ của người khác (body sai) ⇒ 403, không phải 400',
    AREA,
    async () => {
      const bad = { hireDate: 'không-phải-ngày', userId: 'x', expectedVersion: -1 };
      for (const [method, path, body] of [
        ['GET', PROFILE.of(max.userId), undefined],
        ['GET', PROFILE.of('không-phải-uuid'), undefined],
        ['PUT', PROFILE.of(max.userId), bad],
        ['PUT', PROFILE.of('không-phải-uuid'), bad],
        ['GET', PROFILE.departments, undefined],
      ] as const) {
        const res = await call(mia, method, path, body);
        expectStatus(res, 403, `Mia ${method} ${path}`);
        expect(errorOf(res).code).toBe('FORBIDDEN');
      }
    },
  );

  secCase(
    'SEC-HR-41',
    '`/me`: đúng người, có workPhone của mình; Admin ⇒ 403; người đã nghỉ ⇒ 401; `/me` và `/departments` không bị `/:userId` bắt (EP-08)',
    AREA,
    async () => {
      const kim = await actors.createUser('ep41-kim', { startDate: START });
      await putProfile(hana, kim.userId, {
        workPhone: '0901 234 567',
        jobTitle: 'Kế toán viên',
        expectedVersion: 0,
      });
      const me = await call(kim, 'GET', PROFILE.me);
      expectStatus(me, 200, 'Kim /me');
      expect(dataOf<ProfileDto>(me)).toMatchObject({
        userId: kim.userId,
        workPhone: '0901234567',
        jobTitle: 'Kế toán viên',
        version: 1,
      });
      // Người khác gọi /me ⇒ hồ sơ của CHÍNH họ (không phải của Kim).
      const miaMe = dataOf<ProfileDto>(await call(mia, 'GET', PROFILE.me));
      expect(miaMe).toMatchObject({ userId: mia.userId, workPhone: null, version: 0 });

      const adaMe = await call(actors.ada, 'GET', PROFILE.me);
      expectStatus(adaMe, 403, 'Ada /me');
      expect(errorOf(adaMe).code).toBe('FORBIDDEN');

      // HR (là nhân viên) có /me; /departments trả gợi ý, không phải 400 "uuid sai".
      expectStatus(await call(hana, 'GET', PROFILE.me), 200, 'Hana /me');
      const sug = await call(hana, 'GET', PROFILE.departments);
      expectStatus(sug, 200, 'Hana /departments');
      expect(dataOf<{ jobTitles: string[] }>(sug).jobTitles).toContain('Kế toán viên');

      // Đã nghỉ (hoàn tất trong request) ⇒ phiên bị thu hồi.
      await actors.offboard(hana, kim.userId, YESTERDAY);
      const after = await call(kim, 'GET', PROFILE.me);
      expectStatus(after, 401, 'Kim /me sau khi nghỉ');
      expect(['UNAUTHORIZED', 'SESSION_REVOKED']).toContain(errorOf(after).code);
    },
  );

  secCase(
    'SEC-HR-42',
    'HR sửa hồ sơ chính mình ⇒ 403 (tuyệt đối); HR khác hoặc Admin sửa hồ sơ HR ⇒ 200',
    AREA,
    async () => {
      const self = await call(hana, 'PUT', PROFILE.of(hana.userId), {
        department: 'Nhân sự',
        expectedVersion: 0,
      });
      expectStatus(self, 403, 'Hana tự sửa');
      expect(errorOf(self).code).toBe('FORBIDDEN');
      expect((await getProfile(hugo, hana.userId)).version).toBe(0);

      await putProfile(hugo, hana.userId, { department: 'Nhân sự', expectedVersion: 0 });
      await putProfile(actors.ada, hana.userId, { jobTitle: 'Trưởng nhóm', expectedVersion: 1 });
      expect(await getProfile(hugo, hana.userId)).toMatchObject({
        department: 'Nhân sự',
        jobTitle: 'Trưởng nhóm',
        version: 2,
      });
      // Hana vẫn không tự sửa được dù đúng version.
      expectStatus(
        await call(hana, 'PUT', PROFILE.of(hana.userId), { jobTitle: 'X', expectedVersion: 2 }),
        403,
        'Hana tự sửa (đúng version)',
      );
    },
  );

  secCase(
    'SEC-HR-43',
    'GET / PUT hồ sơ của user chưa từng có nhiệm kỳ EMPLOYEE (Admin bootstrap, UUID ngẫu nhiên) ⇒ 404 `user`, cùng body; Admin từng là nhân viên ⇒ 200',
    AREA,
    async () => {
      const bodies: unknown[] = [];
      for (const userId of [actors.ada.userId, randomUUID()]) {
        for (const [method, body] of [
          ['GET', undefined],
          ['PUT', { department: 'X', expectedVersion: 0 }],
        ] as const) {
          const res = await call(hana, method, PROFILE.of(userId), body);
          expectStatus(res, 404, `${method} hồ sơ ${userId}`);
          const e = errorOf(res);
          expect(e.code).toBe('RESOURCE_NOT_FOUND');
          bodies.push({ code: e.code, message: e.message, details: e.details });
        }
      }
      // Không lộ "Ada có tồn tại": body 404 của Ada giống hệt UUID ngẫu nhiên.
      expect(bodies[0]).toEqual(bodies[2]);
      expect(bodies[1]).toEqual(bodies[3]);

      const exEmployee = await actors.createUser('ep43-admin', { admin: true, startDate: START });
      expect(await getProfile(hana, exEmployee.userId)).toMatchObject({
        userId: exEmployee.userId,
        version: 0,
      });
      expectStatus(await call(exEmployee, 'GET', PROFILE.me), 403, 'Admin (từng là NV) /me');
    },
  );

  secCase(
    'SEC-HR-45',
    'mass assignment: PUT hồ sơ có `userId` / `version` / `updatedById` / trường lạ; POST hr/employees có trường lạ cạnh trường hồ sơ ⇒ 400 strict',
    AREA,
    async () => {
      for (const extra of [
        { userId: max.userId },
        { version: 99 },
        { updatedById: hana.userId },
        { nationalId: '001200000000' },
      ]) {
        const res = await call(hana, 'PUT', PROFILE.of(max.userId), {
          department: 'Kho',
          expectedVersion: 0,
          ...extra,
        });
        expectStatus(res, 400, `PUT + ${Object.keys(extra)[0]}`);
        expect(errorOf(res).code).toBe('VALIDATION_ERROR');
      }
      expect((await getProfile(hana, max.userId)).version).toBe(0);

      const email = `ep45-${randomUUID()}@sec.example`;
      const hire = await call(hana, 'POST', '/hr/employees', {
        email,
        fullName: 'Sec ep45',
        department: 'Kho',
        dateOfBirth: '1990-01-01',
      });
      expectStatus(hire, 400, 'POST hr/employees + dateOfBirth');
      const list = await call(hana, 'GET', `/hr/employees?q=${encodeURIComponent(email)}`);
      expect(dataOf<unknown[]>(list)).toEqual([]);
    },
  );

  secCase(
    'SEC-HR-46',
    '`hr/employees?q=` với `%`, `_`, `\\` khớp chữ thường (không trả cả danh sách); `q` 101 ký tự ⇒ 400',
    AREA,
    async () => {
      const tag = randomUUID().slice(0, 6);
      // Ký tự đặc biệt chỉ ở họ tên (email giữ hợp lệ); người chờ kích hoạt vẫn có trong danh sách mặc định.
      const hired = await actors.hire(hana, {
        email: `ep46-${tag}@sec.example`,
        fullName: `Sec ep46_${tag}% \\ phần trăm`,
      });
      expectStatus(hired, 201, 'thêm người tên đặc biệt');
      const special = dataOf<{ employee: { userId: string } }>(hired).employee;
      for (const q of ['%', '_', '\\', `_${tag}%`]) {
        const res = await call(hana, 'GET', `/hr/employees?q=${encodeURIComponent(q)}`);
        expectStatus(res, 200, `q=${q}`);
        const rows = dataOf<{ userId: string; fullName: string; email: string }[]>(res);
        for (const r of rows) {
          expect(
            `${r.fullName} ${r.email}`.toLowerCase().includes(q.toLowerCase()),
            `q=${q} trả ${r.fullName}`,
          ).toBe(true);
        }
        expect(rows.map((r) => r.userId)).toContain(special.userId);
      }
      const all = dataOf<unknown[]>(await call(hana, 'GET', '/hr/employees'));
      const pct = dataOf<unknown[]>(
        await call(hana, 'GET', `/hr/employees?q=${encodeURIComponent('%')}`),
      );
      expect(pct.length).toBeLessThan(all.length);
      const long = await call(hana, 'GET', `/hr/employees?q=${'a'.repeat(101)}`);
      expectStatus(long, 400, 'q 101 ký tự');
    },
  );

  secCase(
    'SEC-HR-47',
    'audit PROFILE_SET không có workPhone (chỉ cờ), lý do ở `after.note` không khóa `reason`; thông báo PROFILE_UPDATED không mang giá trị; log không có SĐT',
    AREA,
    async () => {
      const phone = `09${String(Date.now()).slice(-8)}`;
      const dept = `Phòng-${randomUUID().slice(0, 8)}`;
      const note = `lý-do-${randomUUID().slice(0, 8)}`;
      const before = await actors.notificationIds(max);
      await putProfile(hana, max.userId, {
        hireDate: '2020-03-02',
        department: dept,
        workPhone: phone,
        expectedVersion: 0,
      });
      await putProfile(hana, max.userId, {
        hireDate: '2020-03-01',
        reason: note,
        expectedVersion: 1,
      });

      const rows = await auditOf(max.userId);
      expect(rows).toHaveLength(2);
      for (const r of rows) {
        const text = JSON.stringify(r);
        expect(text).not.toContain(phone);
        expect(r.before ?? {}).not.toHaveProperty('workPhone');
        expect(r.after ?? {}).not.toHaveProperty('workPhone');
        expect(r.after ?? {}).not.toHaveProperty('reason');
        expect(r.after).toHaveProperty('workPhoneChanged');
      }
      const changed = rows.find((r) => r.after?.['hireDate'] === '2020-03-01');
      expect(changed?.after).toMatchObject({ note, workPhoneChanged: false });
      const created = rows.find((r) => r.after?.['hireDate'] === '2020-03-02');
      expect(created?.after).toMatchObject({ department: dept, workPhoneChanged: true });

      const notes = await actors.newNotifications(max, before, {
        type: 'PROFILE_UPDATED',
        refId: max.userId,
      });
      expect(notes).toHaveLength(2);
      const notifText = JSON.stringify(
        dataOf<unknown[]>(await call(max, 'GET', '/me/notifications?limit=50')),
      );
      for (const v of [phone, dept, note, '2020-03-0']) expect(notifText).not.toContain(v);

      const logs = api.logs().join('\n');
      expect(logs).not.toContain(phone);
      expect(logs).not.toContain(note);
    },
  );
});

describe('EP — hồ sơ (hộp đen)', () => {
  secCase(
    'EP-01',
    'PUT lần đầu `expectedVersion 0` ⇒ tạo `version 1`; gửi lại `expectedVersion 0` ⇒ 409 VERSION_CONFLICT; PUT không đổi gì ⇒ 200, không ghi',
    AREA,
    async () => {
      const p = await actors.createUser('ep01', { startDate: START });
      const first = dataOf<PutResult>(
        await putProfile(hana, p.userId, { department: 'Kho', expectedVersion: 0 }),
      );
      expect(first).toMatchObject({
        profile: { version: 1, department: 'Kho' },
        negativeBalances: [],
        warnings: [],
      });
      const again = await call(hana, 'PUT', PROFILE.of(p.userId), {
        department: 'Kho 2',
        expectedVersion: 0,
      });
      expectStatus(again, 409, 'PUT version cũ');
      expect(errorOf(again).code).toBe('VERSION_CONFLICT');
      expect((await getProfile(hana, p.userId)).department).toBe('Kho');

      const before = await actors.notificationIds(p);
      const same = dataOf<PutResult>(
        await putProfile(hana, p.userId, { department: 'Kho', expectedVersion: 1 }),
      );
      expect(same.profile.version).toBe(1);
      expect(await auditOf(p.userId)).toHaveLength(1);
      expect(
        await actors.newNotifications(p, before, { type: 'PROFILE_UPDATED', refId: p.userId }),
      ).toEqual([]);
    },
  );

  secCase(
    'EP-02',
    'biên `hireDate`: 1949-12-31 ⇒ 400; 1950-01-01 ⇒ 200; hôm nay ⇒ 200; ngày mai ⇒ 422 HIRE_DATE_IN_FUTURE; sai mẫu ⇒ 400',
    AREA,
    async () => {
      const p = await actors.createUser('ep02', { startDate: START });
      let version = 0;
      for (const [hireDate, want, rule] of [
        ['1949-12-31', 400, null],
        ['2026-02-30', 400, null],
        ['01/03/2020', 400, null],
        ['1950-01-01', 200, null],
        [TODAY, 200, null],
        [addDays(TODAY, 1), 422, 'HIRE_DATE_IN_FUTURE'],
      ] as const) {
        const res = await call(hana, 'PUT', PROFILE.of(p.userId), {
          hireDate,
          expectedVersion: version,
          ...(version > 0 ? { reason: 'sửa biên' } : {}),
        });
        expectStatus(res, want, `hireDate ${hireDate}`);
        if (want === 200) version += 1;
        if (rule) expect(errorOf(res).details).toMatchObject({ rule });
      }
      expect((await getProfile(hana, p.userId)).hireDate).toBe(TODAY);
    },
  );

  secCase(
    'EP-03',
    '`workPhone` chuẩn hóa (bỏ space . - ( )), giữ `+` đầu; 7 số / 16 số / chữ cái / `+` giữa ⇒ 400; `null` xóa',
    AREA,
    async () => {
      const p = await actors.createUser('ep03', { startDate: START });
      const saved = dataOf<PutResult>(
        await putProfile(hana, p.userId, { workPhone: ' +84 (90) 123-45.67 ', expectedVersion: 0 }),
      );
      expect(saved.profile.workPhone).toBe('+84901234567');
      for (const workPhone of [
        '0901234',
        '0901234567890123',
        '0901abc567',
        '0901+234567',
        '++84901234567',
      ]) {
        const res = await call(hana, 'PUT', PROFILE.of(p.userId), {
          workPhone,
          expectedVersion: 1,
        });
        expectStatus(res, 400, `workPhone ${workPhone}`);
      }
      await putProfile(hana, p.userId, { workPhone: '12345678', expectedVersion: 1 });
      await putProfile(hana, p.userId, { workPhone: '123456789012345', expectedVersion: 2 });
      await putProfile(hana, p.userId, { workPhone: null, expectedVersion: 3 });
      expect((await getProfile(hana, p.userId)).workPhone).toBeNull();
    },
  );

  secCase(
    'EP-04',
    'đổi / xóa `hireDate` ĐÃ CÓ thiếu lý do ⇒ 422 REASON_REQUIRED; có lý do ⇒ 200; đặt lần đầu không lý do ⇒ 200; đổi trường khác không cần lý do',
    AREA,
    async () => {
      const p = await actors.createUser('ep04', { startDate: START });
      await putProfile(hana, p.userId, { hireDate: '2019-03-01', expectedVersion: 0 });
      for (const hireDate of ['2019-04-01', null]) {
        const res = await call(hana, 'PUT', PROFILE.of(p.userId), { hireDate, expectedVersion: 1 });
        expectStatus(res, 422, `đổi hireDate → ${String(hireDate)} không lý do`);
        expect(errorOf(res).details).toMatchObject({ rule: 'REASON_REQUIRED' });
      }
      // Gửi lại đúng giá trị cũ không cần lý do; đổi phòng ban không cần lý do.
      await putProfile(hana, p.userId, {
        hireDate: '2019-03-01',
        department: 'Kho',
        expectedVersion: 1,
      });
      await putProfile(hana, p.userId, {
        hireDate: '2019-04-01',
        reason: 'Nhập nhầm tháng',
        expectedVersion: 2,
      });
      expect(await getProfile(hana, p.userId)).toMatchObject({
        hireDate: '2019-04-01',
        version: 3,
      });
    },
  );

  secCase(
    'EP-05',
    'người đã nghỉ: HR vẫn GET / PUT hồ sơ (status LEFT), không gửi thông báo cho người đã nghỉ',
    AREA,
    async () => {
      const quinn = await departed('ep05-quinn', '2018-06-01');
      const p = await getProfile(hana, quinn.userId);
      expect(p).toMatchObject({
        status: 'LEFT',
        hireDate: '2018-06-01',
        department: 'Kho',
        version: 1,
      });
      await putProfile(hana, quinn.userId, { jobTitle: 'Thủ kho', expectedVersion: 1 });
      expect((await getProfile(hana, quinn.userId)).jobTitle).toBe('Thủ kho');
      expect(await auditOf(quinn.userId)).toHaveLength(2);
    },
  );

  secCase(
    'EP-06',
    'mỗi lần ghi: đúng 1 audit PROFILE_SET (actor, before / after) + đúng 1 thông báo PROFILE_UPDATED cho nhân viên (refId = userId)',
    AREA,
    async () => {
      const p = await actors.createUser('ep06', { startDate: START });
      const before = await actors.notificationIds(p);
      await putProfile(hugo, p.userId, { department: 'Bán hàng', expectedVersion: 0 });
      await putProfile(actors.ada, p.userId, { department: 'Kho', expectedVersion: 1 });
      const rows = await auditOf(p.userId);
      expect(rows).toHaveLength(2);
      const byAda = rows.find((r) => r.after?.['department'] === 'Kho');
      expect(byAda).toMatchObject({
        before: { department: 'Bán hàng' },
        after: { department: 'Kho' },
      });
      expect(
        await actors.newNotifications(p, before, { type: 'PROFILE_UPDATED', refId: p.userId }),
      ).toHaveLength(2);
    },
  );

  secCase(
    'EP-11',
    '`POST hr/employees` có trường hồ sơ ⇒ hồ sơ cùng transaction; lỗi hồ sơ (SĐT 7 số ⇒ 400, hireDate tương lai ⇒ 422) ⇒ không tạo người; không gửi ⇒ không hồ sơ; nhận lại `keepHireDate` true / false / không gửi',
    AREA,
    async () => {
      const hire = (body: Record<string, unknown>) => call(hana, 'POST', '/hr/employees', body);
      const findByEmail = async (email: string) =>
        dataOf<{ userId: string }[]>(
          await call(hana, 'GET', `/hr/employees?q=${encodeURIComponent(email)}`),
        );

      const withProfile = `ep11-a-${randomUUID()}@sec.example`;
      const created = await hire({
        email: withProfile,
        fullName: 'Sec ep11 a',
        hireDate: '2021-05-10',
        department: 'Kho',
        jobTitle: 'Thủ kho',
        workPhone: '0901 111 222',
      });
      expectStatus(created, 201, 'thêm có hồ sơ');
      const aId = dataOf<{ employee: { userId: string } }>(created).employee.userId;
      expect(await getProfile(hana, aId)).toMatchObject({
        hireDate: '2021-05-10',
        department: 'Kho',
        jobTitle: 'Thủ kho',
        workPhone: '0901111222',
        version: 1,
      });

      for (const [extra, want] of [
        [{ workPhone: '0901234' }, 400],
        [{ hireDate: addDays(TODAY, 1) }, 422],
      ] as const) {
        const email = `ep11-x-${randomUUID()}@sec.example`;
        const res = await hire({ email, fullName: 'Sec ep11 x', department: 'Kho', ...extra });
        expectStatus(res, want, `thêm hồ sơ lỗi ${JSON.stringify(extra)}`);
        expect(await findByEmail(email), `${email} không được tạo`).toEqual([]);
      }

      const plain = `ep11-b-${randomUUID()}@sec.example`;
      const bRes = await hire({ email: plain, fullName: 'Sec ep11 b' });
      expectStatus(bRes, 201, 'thêm không hồ sơ');
      const bId = dataOf<{ employee: { userId: string } }>(bRes).employee.userId;
      expect((await getProfile(hana, bId)).version).toBe(0);
      expect(await auditOf(bId)).toEqual([]);

      // Nhận lại: true giữ hireDate cũ (bỏ qua hireDate gửi kèm), false + mới thay, không gửi gì giữ nguyên.
      for (const [label, extra, wantHire] of [
        ['keep', { keepHireDate: true, hireDate: '2024-01-01' }, '2017-02-01'],
        ['replace', { keepHireDate: false, hireDate: '2024-01-01' }, '2024-01-01'],
        ['omit', {}, '2017-02-01'],
      ] as const) {
        const q = await departed(`ep11-${label}`, '2017-02-01');
        const res = await hire({ email: q.email, fullName: `Sec ep11-${label}`, ...extra });
        expectStatus(res, 201, `nhận lại ${label}`);
        expect(dataOf<{ accountCreated: boolean }>(res).accountCreated).toBe(false);
        expect((await getProfile(hana, q.userId)).hireDate, label).toBe(wantHire);
        const rehireRows = (await auditOf(q.userId)).filter((r) => r.after?.['rehire'] === true);
        expect(rehireRows, `${label}: audit rehire`).toHaveLength(label === 'replace' ? 1 : 0);
      }
    },
  );

  secCase(
    'EP-13',
    '`GET hr/employees`: cột hồ sơ phẳng (hireDate, department, jobTitle, missingHireDate, seniority) — KHÔNG có workPhone',
    AREA,
    async () => {
      const p = await actors.createUser('ep13', { startDate: START });
      const [y, m] = TODAY.split('-').map(Number) as [number, number];
      const back = new Date(Date.UTC(y - 2, m - 1 - 3, 1)).toISOString().slice(0, 10);
      await putProfile(hana, p.userId, {
        hireDate: back,
        department: 'Kho',
        workPhone: '0909999888',
        expectedVersion: 0,
      });
      const res = await call(hana, 'GET', `/hr/employees?q=${encodeURIComponent(p.email)}`);
      expectStatus(res, 200, 'GET hr/employees');
      const rows = dataOf<Record<string, unknown>[]>(res);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        userId: p.userId,
        hireDate: back,
        department: 'Kho',
        jobTitle: null,
        missingHireDate: false,
        seniority: { years: 2, months: 3 },
      });
      expect(rows[0]).not.toHaveProperty('workPhone');
      expect(res.text).not.toContain('0909999888');
      const none = dataOf<Record<string, unknown>[]>(
        await call(hana, 'GET', `/hr/employees?q=${encodeURIComponent(mia.email)}`),
      );
      expect(none[0]).toMatchObject({ hireDate: null, missingHireDate: true, seniority: null });
    },
  );
});
