import { randomUUID } from 'node:crypto';

import { beforeAll, describe, expect } from 'vitest';

import { addDays } from './harness/clock';
import { useCompanyApi, type CompanyActor } from './harness/company';
import {
  HR,
  accessVersion,
  adjust,
  eventIdOf,
  eventsOf,
  hrClockEnv,
  leaveOf,
  submitLeave,
  todayVn,
  withKey,
  type AttendanceEventDto,
} from './harness/hr';
import { errorEnvelope, type RawResponse } from './harness/http-client';
import { secCase } from './harness/suite';
import { flushRateLimitCounters } from './harness/valkey';

// Mốc 5 — đơn bổ sung giờ (ADR-129, T-055 B + T-056 A; test-spec-hr-extended §3, §6): SEC-HR-40c / 45c (vế đơn của
// SEC-HR-40 / 45 — vế hồ sơ ở hr-profile.sec.ts), 48…51 · CR-01…06, 08…13, 14 (vế S), 15. Mốc nghiệp vụ thứ Ba 10:00 VN (SEC_CLOCK_ANCHOR). Mỗi ca tự tạo người
// (`startDate` −31 để ngày cuối tháng trước luôn trong nhiệm kỳ); thông báo theo delta `refId` (§0.4).

const { api, actors } = useCompanyApi(hrClockEnv());
const AREA = 'Mốc 5 đơn bổ sung giờ (T-056)';
const TODAY = todayVn();
const YESTERDAY = addDays(TODAY, -1);
const START = addDays(TODAY, -31);
const LAST_OF_PREV = addDays(`${TODAY.slice(0, 7)}-01`, -1);
const LAST_OF_PREV2 = addDays(`${LAST_OF_PREV.slice(0, 7)}-01`, -1);

const C = {
  root: '/attendance/corrections',
  mine: '/attendance/corrections?mine=1',
  list: (status?: string) => `/attendance/corrections${status ? `?status=${status}` : ''}`,
  action: (id: string, a: 'cancel' | 'approve' | 'reject') => `/attendance/corrections/${id}/${a}`,
};

interface CorrectionDto {
  id: string;
  userId: string;
  date: string;
  kind: 'IN' | 'OUT';
  time: string;
  nextDay: boolean;
  status: string;
  version: number;
  createdEventId: string | null;
  reason?: string | null;
  day: { date: string; status: string; firstIn?: string | null; lastOut?: string | null };
}
interface ApprovedDto {
  request: CorrectionDto;
  event: AttendanceEventDto & { occurredAt: string; note: string | null };
  day: { status: string };
}
interface AuditRow {
  action: string;
  targetUserId: string | null;
  refId: string | null;
  after: Record<string, unknown> | null;
}

let hana: CompanyActor; // nhân viên + HR_MANAGE
let hugo: CompanyActor; // nhân viên + HR_MANAGE (HR thứ hai)

beforeAll(async () => {
  hana = await actors.createUser('cr-hana', { grants: ['HR_MANAGE'], startDate: START });
  hugo = await actors.createUser('cr-hugo', { grants: ['HR_MANAGE'], startDate: START });
}, 120_000);

const call = (who: CompanyActor | undefined, method: string, path: string, body?: unknown) =>
  actors.json(method, path, who?.accessToken, body);
const expectStatus = (res: RawResponse, status: number, what: string) =>
  expect(res.status, `${what}: ${res.text.slice(0, 300)}`).toBe(status);
const errorOf = (res: RawResponse) => errorEnvelope(res).error;
const dataOf = <T>(res: RawResponse) => (res.json as { data: T }).data;
const employee = (label: string, startDate = START) => actors.createUser(label, { startDate });

interface SubmitBody {
  date: string;
  kind: 'IN' | 'OUT';
  time: string;
  nextDay?: boolean;
  reason?: string;
}
const submit = (who: CompanyActor, body: SubmitBody, key: string | undefined = randomUUID()) =>
  withKey(api, 'POST', C.root, who.accessToken, key, { reason: 'Quên bấm Ra khi về', ...body });

async function submitted(who: CompanyActor, body: SubmitBody): Promise<CorrectionDto> {
  const res = await submit(who, body);
  expectStatus(res, 201, `gửi đơn ${JSON.stringify(body)}`);
  return dataOf<CorrectionDto>(res);
}

const decide = (
  by: CompanyActor,
  c: Pick<CorrectionDto, 'id' | 'version'>,
  a: 'approve' | 'reject',
  extra: Record<string, unknown> = {},
) => call(by, 'POST', C.action(c.id, a), { expectedVersion: c.version, ...extra });

async function punch(userId: string, kind: 'IN' | 'OUT', time: string, date = YESTERDAY) {
  const res = await adjust(actors, hana, userId, kind, time, 'F seed', date);
  expectStatus(res, 201, `HR thêm ${kind} ${date} ${time}`);
  return eventIdOf(res);
}

async function validEvents(userId: string, date: string) {
  const res = await call(hana, 'GET', HR.eventsOf(userId, date));
  expectStatus(res, 200, 'lượt thô');
  return eventsOf(res).filter((e) => e.voidedAt === null);
}

const ruleOf = (res: RawResponse) => (errorOf(res).details as { rule?: string } | null)?.rule;
const reasonOf = (res: RawResponse) => (errorOf(res).details as { reason?: string } | null)?.reason;

async function auditRows(filter: (r: AuditRow) => boolean): Promise<AuditRow[]> {
  const res = await call(actors.ada, 'GET', `${HR.auditLogs}?limit=100`);
  expectStatus(res, 200, 'audit');
  return dataOf<AuditRow[]>(res).filter(filter);
}

describe('quyền, IDOR, strict', () => {
  secCase(
    'SEC-HR-40c',
    'nhân viên thường duyệt / từ chối đơn (body sai) và gọi danh sách HR (query sai) ⇒ 403, không 400',
    AREA,
    async () => {
      const mia = await employee('cr40-mia');
      const max = await employee('cr40-max');
      await punch(mia.userId, 'IN', '08:00');
      const c = await submitted(mia, { date: YESTERDAY, kind: 'OUT', time: '17:30' });
      for (const [method, path, body] of [
        ['POST', C.action(c.id, 'approve'), { expectedVersion: 'x', userId: 1 }],
        ['POST', C.action(c.id, 'reject'), { expectedVersion: -1 }],
        ['POST', C.action('không-phải-uuid', 'approve'), {}],
        ['GET', `${C.list()}?status=SAI`, undefined],
        ['GET', C.list('PENDING'), undefined],
      ] as const) {
        const res = await call(max, method, path, body);
        expectStatus(res, 403, `Max ${method} ${path}`);
        expect(errorOf(res).code).toBe('FORBIDDEN_ACCESS');
      }
    },
  );

  secCase(
    'SEC-HR-45c',
    'mass assignment: POST attendance/corrections có `userId` / `status` / `createdEventId` ⇒ 400 strict (không gửi hộ)',
    AREA,
    async () => {
      const mia = await employee('cr45-mia');
      const max = await employee('cr45-max');
      for (const extra of [
        { userId: max.userId },
        { status: 'APPROVED' },
        { createdEventId: randomUUID() },
      ]) {
        const res = await withKey(api, 'POST', C.root, mia.accessToken, randomUUID(), {
          date: YESTERDAY,
          kind: 'IN',
          time: '08:00',
          reason: 'x',
          ...extra,
        });
        expectStatus(res, 400, `gửi đơn + ${Object.keys(extra)[0]}`);
        expect(errorOf(res).code).toBe('VALIDATION_ERROR');
      }
      expect(dataOf<unknown[]>(await call(max, 'GET', C.mine))).toEqual([]);
      expect(dataOf<unknown[]>(await call(mia, 'GET', C.mine))).toEqual([]);
    },
  );

  secCase(
    'SEC-HR-48',
    'IDOR: Max hủy đơn của Mia ⇒ 404 (giống đơn không tồn tại); `?mine=1` của Max không thấy đơn Mia; Max gọi danh sách HR ⇒ 403',
    AREA,
    async () => {
      const mia = await employee('cr48-mia');
      const max = await employee('cr48-max');
      const c = await submitted(mia, { date: YESTERDAY, kind: 'IN', time: '08:00' });
      const foreign = await call(max, 'POST', C.action(c.id, 'cancel'), { expectedVersion: 1 });
      const missing = await call(max, 'POST', C.action(randomUUID(), 'cancel'), {
        expectedVersion: 1,
      });
      expectStatus(foreign, 404, 'Max hủy đơn Mia');
      expectStatus(missing, 404, 'Max hủy đơn không tồn tại');
      expect(errorOf(foreign).details).toEqual(errorOf(missing).details);
      expect(errorOf(foreign).message).toBe(errorOf(missing).message);
      const maxMine = await call(max, 'GET', C.mine);
      expectStatus(maxMine, 200, 'Max mine');
      expect(maxMine.text).not.toContain(c.id);
      expectStatus(await call(max, 'GET', C.list()), 403, 'Max danh sách HR');
      expect(dataOf<CorrectionDto[]>(await call(mia, 'GET', C.mine)).map((x) => x.id)).toEqual([
        c.id,
      ]);
    },
  );

  secCase(
    'SEC-HR-49',
    'HR tự duyệt / từ chối đơn của mình ⇒ 403; Hugo bị thu HR_MANAGE giữa lúc mở và duyệt ⇒ 403, không lượt ADJUSTMENT',
    AREA,
    async () => {
      const own = await submitted(hana, { date: YESTERDAY, kind: 'IN', time: '08:00' });
      for (const a of ['approve', 'reject'] as const) {
        const res = await decide(hana, own, a);
        expectStatus(res, 403, `Hana tự ${a}`);
        expect(errorOf(res).code).toBe('FORBIDDEN_ACCESS');
      }

      const hr2 = await actors.createUser('cr49-hr2', { grants: ['HR_MANAGE'], startDate: START });
      const mia = await employee('cr49-mia');
      const c = await submitted(mia, { date: YESTERDAY, kind: 'IN', time: '08:00' });
      const listed = await call(hr2, 'GET', C.list('PENDING'));
      expectStatus(listed, 200, 'HR2 mở danh sách');
      const version = await accessVersion(actors, hr2.userId);
      await actors.setAccess(actors.ada, hr2.userId, {
        role: 'EMPLOYEE',
        grants: [],
        expectedVersion: version,
      });
      expectStatus(await decide(hr2, c, 'approve'), 403, 'duyệt sau khi bị thu quyền');
      expect(await validEvents(mia.userId, YESTERDAY)).toEqual([]);
      expect(dataOf<CorrectionDto[]>(await call(mia, 'GET', C.mine))[0]?.status).toBe('PENDING');
    },
  );

  secCase(
    'SEC-HR-50',
    'HR gửi đơn ⇒ không nhận thông báo đơn của chính mình, HR khác + Admin nhận; thu grant ⇒ CORRECTION_SUBMITTED / CANCELLED biến mất khỏi chuông',
    AREA,
    async () => {
      const hr3 = await actors.createUser('cr50-hr3', { grants: ['HR_MANAGE'], startDate: START });
      const watchers = [hana, hugo, hr3, actors.ada];
      const before = await Promise.all(watchers.map((w) => actors.notificationIds(w)));
      const c = await submitted(hana, { date: YESTERDAY, kind: 'IN', time: '08:00' });
      const got = await Promise.all(
        watchers.map((w, i) =>
          actors.newNotifications(w, before[i] as Set<string>, {
            type: 'CORRECTION_SUBMITTED',
            refId: c.id,
          }),
        ),
      );
      expect(got.map((g) => g.length)).toEqual([0, 1, 1, 1]);

      const cancelled = await call(hana, 'POST', C.action(c.id, 'cancel'), {
        expectedVersion: c.version,
      });
      expectStatus(cancelled, 200, 'Hana hủy đơn');
      expect(
        await actors.newNotifications(hr3, before[2] as Set<string>, {
          type: 'CORRECTION_CANCELLED',
          refId: c.id,
        }),
      ).toHaveLength(1);

      await actors.setAccess(actors.ada, hr3.userId, {
        role: 'EMPLOYEE',
        grants: [],
        expectedVersion: await accessVersion(actors, hr3.userId),
      });
      for (const type of ['CORRECTION_SUBMITTED', 'CORRECTION_CANCELLED']) {
        expect(
          await actors.newNotifications(hr3, before[2] as Set<string>, { type, refId: c.id }),
          `${type} còn trong chuông sau khi thu grant`,
        ).toEqual([]);
      }
    },
  );

  secCase(
    'SEC-HR-51',
    'lý do đơn không có trong thông báo, audit, log, `note` lượt chấm, ô ngày; người không phải người gửi / HR không thấy; gửi đơn lần 21 trong giờ ⇒ 429',
    AREA,
    async () => {
      const mia = await employee('cr51-mia');
      const marker = `ốm-${randomUUID().slice(0, 8)}`;
      await punch(mia.userId, 'IN', '08:00');
      const beforeHugo = await actors.notificationIds(hugo);
      const res = await submit(mia, {
        date: YESTERDAY,
        kind: 'OUT',
        time: '17:30',
        reason: marker,
      });
      expectStatus(res, 201, 'gửi đơn');
      const c = dataOf<CorrectionDto>(res);
      expect(c.reason).toBe(marker);
      const approved = await decide(hugo, c, 'approve', { note: 'đã xem camera' });
      expectStatus(approved, 200, 'Hugo duyệt');
      expect(dataOf<ApprovedDto>(approved).event.note ?? '').not.toContain(marker);

      const sources: [string, string][] = [
        [
          'thông báo Hugo',
          JSON.stringify(
            await actors.newNotifications(hugo, beforeHugo, {
              type: 'CORRECTION_SUBMITTED',
              refId: c.id,
            }),
          ),
        ],
        ['chuông Hugo', (await call(hugo, 'GET', '/me/notifications?limit=50')).text],
        ['chuông Mia', (await call(mia, 'GET', '/me/notifications?limit=50')).text],
        [
          'audit',
          JSON.stringify(await auditRows((r) => r.refId === c.id || r.targetUserId === mia.userId)),
        ],
        ['lượt chấm', JSON.stringify(await validEvents(mia.userId, YESTERDAY))],
        ['ngày công', (await call(mia, 'GET', HR.me(YESTERDAY.slice(0, 7)))).text],
        ['log API', api.logs().join('\n')],
      ];
      for (const [where, text] of sources)
        expect(text, `${where} chứa lý do`).not.toContain(marker);

      // Hạn mức 20/giờ/user: request thứ 21 (kể cả khi các lần trước bị 422) ⇒ 429.
      const spam = await employee('cr51-spam');
      await flushRateLimitCounters();
      for (let i = 0; i < 20; i += 1) {
        const r = await submit(spam, { date: addDays(TODAY, 1), kind: 'IN', time: '08:00' });
        expect(r.status, `lần ${i + 1}`).not.toBe(429);
      }
      const limited = await submit(spam, { date: YESTERDAY, kind: 'IN', time: '08:00' });
      expectStatus(limited, 429, 'lần 21');
      expect(dataOf<unknown[]>(await call(spam, 'GET', C.mine))).toEqual([]);
    },
  );
});

describe('CR — luật gửi (hộp đen)', () => {
  secCase(
    'CR-01',
    'cửa sổ ngày: hôm nay, ngày cuối tháng trước ⇒ 201; cuối tháng trước nữa, ngày mai ⇒ 422 CORRECTION_DATE_OUT_OF_RANGE; trước `start_date` của nhiệm kỳ ⇒ 422, đúng `start_date` ⇒ 201',
    AREA,
    async () => {
      const mia = await employee('cr01-mia');
      for (const [date, want] of [
        [TODAY, 201],
        [LAST_OF_PREV, 201],
        [LAST_OF_PREV2, 422],
        [addDays(TODAY, 1), 422],
      ] as const) {
        const res = await submit(mia, { date, kind: 'IN', time: '08:00' });
        expectStatus(res, want, `IN ${date}`);
        if (want === 422) expect(ruleOf(res)).toBe('CORRECTION_DATE_OUT_OF_RANGE');
      }
      const late = await employee('cr01-late', addDays(TODAY, -3));
      const before = await submit(late, { date: addDays(TODAY, -4), kind: 'IN', time: '08:00' });
      expectStatus(before, 422, 'trước start_date');
      expect(ruleOf(before)).toBe('CORRECTION_DATE_OUT_OF_RANGE');
      expectStatus(
        await submit(late, { date: addDays(TODAY, -3), kind: 'IN', time: '08:00' }),
        201,
        'đúng start_date',
      );
    },
  );

  secCase(
    'CR-02',
    'thời điểm xin ở tương lai (hôm nay 23:00; OUT `nextDay` 00:30 cho hôm nay) ⇒ 422 CORRECTION_IN_FUTURE',
    AREA,
    async () => {
      const mia = await employee('cr02-mia');
      const later = await submit(mia, { date: TODAY, kind: 'IN', time: '23:00' });
      expectStatus(later, 422, 'IN 23:00 hôm nay');
      expect(ruleOf(later)).toBe('CORRECTION_IN_FUTURE');
      await punch(mia.userId, 'IN', '08:00', TODAY);
      const night = await submit(mia, { date: TODAY, kind: 'OUT', time: '00:30', nextDay: true });
      expectStatus(night, 422, 'OUT nextDay 00:30');
      expect(ruleOf(night)).toBe('CORRECTION_IN_FUTURE');
    },
  );

  secCase(
    'CR-03',
    'không thay thế: đã có IN ⇒ xin IN 422 CORRECTION_EVENT_EXISTS; đã có OUT sau firstIn ⇒ xin OUT 422; IN đã hủy ⇒ xin IN 201',
    AREA,
    async () => {
      const mia = await employee('cr03-mia');
      const inId = await punch(mia.userId, 'IN', '08:00');
      const dupIn = await submit(mia, { date: YESTERDAY, kind: 'IN', time: '07:55' });
      expectStatus(dupIn, 422, 'xin IN khi đã có IN');
      expect(ruleOf(dupIn)).toBe('CORRECTION_EVENT_EXISTS');
      await punch(mia.userId, 'OUT', '17:30');
      const dupOut = await submit(mia, { date: YESTERDAY, kind: 'OUT', time: '18:00' });
      expectStatus(dupOut, 422, 'xin OUT khi đã có OUT');
      expect(ruleOf(dupOut)).toBe('CORRECTION_EVENT_EXISTS');

      expectStatus(
        await call(hana, 'POST', HR.voidEvent(inId), { reason: 'chấm nhầm' }),
        200,
        'HR hủy IN',
      );
      expectStatus(
        await submit(mia, { date: YESTERDAY, kind: 'IN', time: '08:05' }),
        201,
        'xin IN sau khi IN bị hủy',
      );
    },
  );

  secCase(
    'CR-04',
    'thứ tự: OUT ≤ firstIn, IN ≥ lastOut, OUT khi chưa có IN ⇒ 422 CORRECTION_TIME_ORDER; `nextDay` với giờ ≥ 06:00 hoặc với IN ⇒ 400 path nextDay; OUT 05:59 nextDay hôm qua ⇒ 201',
    AREA,
    async () => {
      const a = await employee('cr04-a');
      await punch(a.userId, 'IN', '08:00');
      for (const time of ['07:30', '08:00']) {
        const r = await submit(a, { date: YESTERDAY, kind: 'OUT', time });
        expectStatus(r, 422, `OUT ${time} ≤ firstIn`);
        expect(ruleOf(r)).toBe('CORRECTION_TIME_ORDER');
      }
      const b = await employee('cr04-b');
      const orphan = await submit(b, { date: YESTERDAY, kind: 'OUT', time: '17:30' });
      expectStatus(orphan, 422, 'OUT khi chưa có IN');
      expect(ruleOf(orphan)).toBe('CORRECTION_TIME_ORDER');
      await punch(b.userId, 'OUT', '17:30');
      const inAfter = await submit(b, { date: YESTERDAY, kind: 'IN', time: '18:00' });
      expectStatus(inAfter, 422, 'IN ≥ lastOut');
      expect(ruleOf(inAfter)).toBe('CORRECTION_TIME_ORDER');

      for (const body of [
        { date: YESTERDAY, kind: 'OUT', time: '06:00', nextDay: true },
        { date: YESTERDAY, kind: 'OUT', time: '07:00', nextDay: true },
        { date: YESTERDAY, kind: 'IN', time: '05:00', nextDay: true },
      ] as const) {
        const r = await submit(a, body);
        expectStatus(r, 400, `nextDay ${body.kind} ${body.time}`);
        expect(JSON.stringify(errorOf(r).details)).toContain('nextDay');
      }
      expectStatus(
        await submit(a, { date: YESTERDAY, kind: 'OUT', time: '05:59', nextDay: true }),
        201,
        'OUT 05:59 sáng nay cho hôm qua',
      );
    },
  );

  secCase(
    'CR-05',
    'ngày có phép CẢ NGÀY đã duyệt ⇒ 422 CORRECTION_DAY_ON_LEAVE; phép nửa ngày ⇒ 201',
    AREA,
    async () => {
      const full = await employee('cr05-full');
      const half = await employee('cr05-half');
      for (const [who, dayPart] of [
        [full, 'FULL'],
        [half, 'AM'],
      ] as const) {
        const sent = await submitLeave(actors, who, {
          type: 'UNPAID',
          startDate: TODAY,
          endDate: TODAY,
          dayPart,
          reason: 'việc nhà',
        });
        expectStatus(sent, 201, `xin nghỉ ${dayPart}`);
        const leave = leaveOf(sent);
        expectStatus(
          await call(hana, 'POST', HR.leaveAction(leave.id, 'approve'), {
            expectedVersion: leave.version,
          }),
          200,
          `duyệt nghỉ ${dayPart}`,
        );
      }
      const r = await submit(full, { date: TODAY, kind: 'IN', time: '08:00' });
      expectStatus(r, 422, 'xin IN ngày nghỉ cả ngày');
      expect(ruleOf(r)).toBe('CORRECTION_DAY_ON_LEAVE');
      expectStatus(
        await submit(half, { date: TODAY, kind: 'IN', time: '08:00' }),
        201,
        'xin IN ngày nghỉ nửa ngày',
      );
    },
  );

  secCase(
    'CR-06',
    'một PENDING / (user, ngày, loại): đơn thứ hai (key khác) ⇒ 409 correction_pending_exists; hủy rồi gửi lại ⇒ 201',
    AREA,
    async () => {
      const mia = await employee('cr06-mia');
      const first = await submitted(mia, { date: YESTERDAY, kind: 'IN', time: '08:00' });
      const second = await submit(mia, { date: YESTERDAY, kind: 'IN', time: '08:10' });
      expectStatus(second, 409, 'đơn thứ hai');
      expect(errorOf(second).code).toBe('RESOURCE_CONFLICT');
      expect(reasonOf(second)).toBe('correction_pending_exists');
      expectStatus(
        await call(mia, 'POST', C.action(first.id, 'cancel'), { expectedVersion: first.version }),
        200,
        'hủy',
      );
      expectStatus(
        await submit(mia, { date: YESTERDAY, kind: 'IN', time: '08:10' }),
        201,
        'gửi lại sau khi hủy',
      );
    },
  );
});

describe('CR — duyệt', () => {
  secCase(
    'CR-08',
    'duyệt tạo đúng 1 ADJUSTMENT, `occurredAt` bằng `adjust` cùng tham số, `note` không chép lý do; thông báo CORRECTION_APPROVED (không ATTENDANCE_ADJUSTED); audit CORRECTION_DECIDE + EVENT_ADJUST; ô ngày MISSING_OUT ⇒ PRESENT (CR-12)',
    AREA,
    async () => {
      const mia = await employee('cr08-mia');
      const twin = await employee('cr08-twin');
      await punch(mia.userId, 'IN', '08:00');
      const c = await submitted(mia, { date: YESTERDAY, kind: 'OUT', time: '17:45' });
      expect(c.day.status).toBe('MISSING_OUT');
      const before = await actors.notificationIds(mia);
      const res = await decide(hugo, c, 'approve');
      expectStatus(res, 200, 'duyệt');
      const out = dataOf<ApprovedDto>(res);
      expect(out.request).toMatchObject({ status: 'APPROVED', createdEventId: out.event.id });
      expect(out.event).toMatchObject({ kind: 'OUT', source: 'ADJUSTMENT', workDate: YESTERDAY });
      expect(out.event.note ?? '').toContain('Đơn bổ sung giờ');
      expect(out.event.note ?? '').toContain(c.id);
      expect(out.day.status).toBe('PRESENT');

      // occurredAt giống hệt HR thêm tay cùng (ngày, giờ, nextDay) cho người khác.
      const manual = await adjust(
        actors,
        hana,
        twin.userId,
        'OUT',
        '17:45',
        'đối chứng',
        YESTERDAY,
      );
      expectStatus(manual, 201, 'adjust đối chứng');
      const manualAt = (manual.json as { data: { event: { occurredAt: string } } }).data.event
        .occurredAt;
      expect(out.event.occurredAt).toBe(manualAt);

      const outs = (await validEvents(mia.userId, YESTERDAY)).filter((e) => e.kind === 'OUT');
      expect(outs).toHaveLength(1);
      expect(
        await actors.newNotifications(mia, before, { type: 'CORRECTION_APPROVED', refId: c.id }),
      ).toHaveLength(1);
      expect(
        (
          await actors.newNotifications(mia, before, {
            type: 'ATTENDANCE_ADJUSTED',
            refId: out.event.id,
          })
        ).length,
      ).toBe(0);
      const actions = (await auditRows((r) => r.refId === c.id || r.refId === out.event.id)).map(
        (r) => r.action,
      );
      expect(actions).toEqual(
        expect.arrayContaining(['CORRECTION_SUBMIT', 'CORRECTION_DECIDE', 'EVENT_ADJUST']),
      );
    },
  );

  secCase(
    'CR-09',
    'gửi khi chưa có lượt; HR thêm tay cùng loại; duyệt ⇒ 422 CORRECTION_EVENT_EXISTS (kiểm lại luật trong khóa), đơn còn PENDING, từ chối được',
    AREA,
    async () => {
      const mia = await employee('cr09-mia');
      const c = await submitted(mia, { date: YESTERDAY, kind: 'IN', time: '08:00' });
      await punch(mia.userId, 'IN', '08:02');
      const r = await decide(hugo, c, 'approve');
      expectStatus(r, 422, 'duyệt khi đã có IN');
      expect(ruleOf(r)).toBe('CORRECTION_EVENT_EXISTS');
      expect(await validEvents(mia.userId, YESTERDAY)).toHaveLength(1);
      expectStatus(await decide(hugo, c, 'reject', { note: 'đã thêm tay' }), 200, 'từ chối');
    },
  );

  secCase(
    'CR-10',
    'duyệt lặp: cùng HR + cùng expectedVersion ⇒ 200, không lượt mới; HR khác ⇒ 409 invalid_transition; version cũ khi còn PENDING ⇒ 409 VERSION_CONFLICT',
    AREA,
    async () => {
      const mia = await employee('cr10-mia');
      const c = await submitted(mia, { date: YESTERDAY, kind: 'IN', time: '08:00' });
      const stale = await decide(hugo, { id: c.id, version: c.version + 1 }, 'approve');
      expectStatus(stale, 409, 'version lệch');
      expect(errorOf(stale).code).toBe('VERSION_CONFLICT');
      expectStatus(await decide(hugo, c, 'approve'), 200, 'duyệt lần 1');
      const again = await decide(hugo, c, 'approve');
      expectStatus(again, 200, 'duyệt lặp cùng người');
      expect(dataOf<ApprovedDto>(again).request.status).toBe('APPROVED');
      expect(await validEvents(mia.userId, YESTERDAY)).toHaveLength(1);
      const other = await decide(hana, c, 'approve');
      expectStatus(other, 409, 'HR khác duyệt lại');
      expect(reasonOf(other)).toBe('invalid_transition');
      expect(await validEvents(mia.userId, YESTERDAY)).toHaveLength(1);
    },
  );

  secCase(
    'CR-11',
    'người gửi bị nâng Admin rồi mới duyệt ⇒ 422 REQUESTER_NOT_EMPLOYEE, từ chối vẫn 200',
    AREA,
    async () => {
      const mia = await employee('cr11-mia');
      const c = await submitted(mia, { date: YESTERDAY, kind: 'IN', time: '08:00' });
      await actors.setAccess(actors.ada, mia.userId, {
        role: 'ADMIN',
        grants: [],
        expectedVersion: await accessVersion(actors, mia.userId),
      });
      const list = dataOf<CorrectionDto[]>(await call(hana, 'GET', C.list()));
      const now = list.find((x) => x.id === c.id);
      expect(now?.status, 'nâng Admin có hủy đơn không?').toBe('PENDING');
      const r = await decide(hugo, now ?? c, 'approve');
      expectStatus(r, 422, 'duyệt đơn của người đã thành Admin');
      expect(ruleOf(r)).toBe('REQUESTER_NOT_EMPLOYEE');
      expectStatus(await decide(hugo, now ?? c, 'reject'), 200, 'từ chối');
    },
  );

  secCase(
    'CR-13',
    'Idempotency-Key: lặp cùng body ⇒ 200 cùng đơn (1 dòng); cùng key body khác ⇒ 422 IDEMPOTENCY_KEY_REUSED; thiếu header ⇒ 400',
    AREA,
    async () => {
      const mia = await employee('cr13-mia');
      const key = randomUUID();
      const body = { date: YESTERDAY, kind: 'IN', time: '08:00' } as const;
      const first = await submit(mia, body, key);
      expectStatus(first, 201, 'lần 1');
      const again = await submit(mia, body, key);
      expectStatus(again, 200, 'lặp cùng key');
      expect(dataOf<CorrectionDto>(again).id).toBe(dataOf<CorrectionDto>(first).id);
      const changed = await submit(mia, { ...body, time: '08:30' }, key);
      expectStatus(changed, 422, 'cùng key body khác');
      expect(ruleOf(changed)).toBe('IDEMPOTENCY_KEY_REUSED');
      const noKey = await api.request({
        method: 'POST',
        path: `/api/v1${C.root}`,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${mia.accessToken}`,
          origin: api.webOrigin,
        },
        body: JSON.stringify({ ...body, date: LAST_OF_PREV, reason: 'x' }),
      });
      expectStatus(noKey, 400, 'thiếu Idempotency-Key');
      expect(dataOf<unknown[]>(await call(mia, 'GET', C.mine))).toHaveLength(1);
    },
  );

  secCase(
    'CR-14',
    'hoàn tất nghỉ việc ⇒ đơn PENDING của người nghỉ thành CANCELLED; đơn đã duyệt giữ nguyên',
    AREA,
    async () => {
      const quinn = await employee('cr14-quinn');
      await punch(quinn.userId, 'IN', '08:00', addDays(TODAY, -3));
      const done = await submitted(quinn, { date: addDays(TODAY, -3), kind: 'OUT', time: '17:30' });
      expectStatus(await decide(hugo, done, 'approve'), 200, 'duyệt trước khi nghỉ');
      const open = await submitted(quinn, { date: addDays(TODAY, -2), kind: 'IN', time: '08:00' });
      expect((await actors.offboard(hana, quinn.userId, YESTERDAY)).employee.status).toBe('LEFT');
      const all = dataOf<CorrectionDto[]>(await call(hana, 'GET', `${C.root}?limit=100`));
      expect(all.find((x) => x.id === open.id)?.status).toBe('CANCELLED');
      expect(all.find((x) => x.id === done.id)?.status).toBe('APPROVED');
    },
  );

  secCase(
    'CR-15',
    'danh sách: nhân viên `?mine=1` chỉ đơn của mình (có lý do); HR `?status=PENDING` kèm ô ngày (giờ vào hiện có, trạng thái)',
    AREA,
    async () => {
      const mia = await employee('cr15-mia');
      const max = await employee('cr15-max');
      await punch(mia.userId, 'IN', '08:00');
      const c = await submitted(mia, { date: YESTERDAY, kind: 'OUT', time: '17:30' });
      await submitted(max, { date: YESTERDAY, kind: 'IN', time: '08:00' });
      const mine = dataOf<CorrectionDto[]>(await call(mia, 'GET', C.mine));
      expect(mine.map((x) => x.userId)).toEqual([mia.userId]);
      expect(mine[0]?.reason).toBe('Quên bấm Ra khi về');
      const pending = dataOf<CorrectionDto[]>(await call(hana, 'GET', C.list('PENDING')));
      const row = pending.find((x) => x.id === c.id);
      expect(row).toMatchObject({ status: 'PENDING', reason: 'Quên bấm Ra khi về' });
      expect(row?.day).toMatchObject({ date: YESTERDAY, status: 'MISSING_OUT' });
      expect(pending.every((x) => x.status === 'PENDING')).toBe(true);
    },
  );
});
