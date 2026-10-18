// SEC-PAY-14 (test-spec-payroll, B — T-048): ném lỗi GIỮA CHỪNG trên route lương ⇒ số tiền KHÔNG có trong response, log
// (pino) hay event Sentry. Lỗi giả lập đúng các dạng message mà Postgres / Prisma nhắc lại giá trị gốc: dòng vi phạm CHECK,
// khóa trùng, ngoài miền BIGINT, sai cú pháp kiểu số. Request đi qua route thật (authenticate → quyền → validate → use
// case), lỗi ném từ store đúng lúc ghi phiếu.
import { Writable } from 'node:stream';

import { PayslipDto } from '@taskflow/contracts/payroll';
import type { ErrorEvent } from '@sentry/node';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { sanitizeErrorEvent } from '../../src/core/observability/sentry';
import { envelopeOf } from '../support/http';
import { createTestApp, type TestApp, type TestUser } from '../support/http-app';

/** Số tiền "đánh dấu" — không trùng với id / giờ / số đếm nào khác trong test. */
const BASE = 9_876_543;
const BONUS = 7_654_321;
const HUGE = '98765430000000000000';
const MONEY = [String(BASE), String(BONUS), HUGE, '9876543', '7654321'];

/** Message thật của Postgres / Prisma khi dữ liệu lương sai — mỗi cái mang giá trị gốc. */
const DB_ERRORS = [
  `new row for relation "payslips" violates check constraint "payslips_net_pay_chk". Failing row contains (00000000-0000-7000-8000-000000000001, 1, Mia, L2, ${BASE}, ${BONUS}, 0).`,
  `duplicate key value violates unique constraint "salary_profiles_user_id_effective_from_key". Key (user_id, base_salary)=(00000000-0000-7000-8000-000000000001, ${BASE}) already exists.`,
  `value "${HUGE}" is out of range for type bigint`,
  `invalid input syntax for type bigint: "${BONUS}.5"`,
];

let t: TestApp;
let lines: string[];
let kai: TestUser; // nhân viên + PAYROLL_MANAGE
let mia: TestUser;

const api = (path: string) => `/api/v1${path}`;

beforeEach(async () => {
  lines = [];
  const logDestination = new Writable({
    write(chunk: Buffer, _enc, cb) {
      lines.push(...chunk.toString().split('\n').filter(Boolean));
      cb();
    },
  });
  t = createTestApp({}, { logDestination });
  t.clock.set(new Date('2026-12-01T10:00:00+07:00'));
  kai = await t.register('Kai', undefined, { grants: ['PAYROLL_MANAGE'], startDate: '2026-11-01' });
  mia = await t.register('Mia', undefined, { startDate: '2026-11-01' });
  const profile = await request(t.app)
    .post(api(`/payroll/salary-profiles/${mia.id}`))
    .set(kai.auth)
    .send({ effectiveFrom: '2026-11', level: 'L2', baseSalary: BASE });
  expect(profile.status, profile.text).toBe(201);
  const run = await request(t.app).post(api('/payroll/runs/2026-11')).set(kai.auth).send({});
  expect(run.status, run.text).toBe(201);
});

const leaksMoney = (text: string) => MONEY.filter((m) => text.includes(m));

describe('SEC-PAY-14 — lỗi giữa chừng trên route lương không lộ số tiền', () => {
  it.each(DB_ERRORS.map((m, i) => [i, m] as const))(
    'lỗi DB #%i khi lưu phiếu ⇒ 500 chung; response + log không có số tiền',
    async (_i, message) => {
      const slip = PayslipDto.parse(
        envelopeOf(
          await request(t.app)
            .get(api(`/payroll/runs/2026-11/payslips/${mia.id}`))
            .set(kai.auth),
        ).data,
      );
      const store = t.persistence.payroll.store;
      store.updateDraftPayslip = () => Promise.reject(new Error(message));
      lines.length = 0;

      const res = await request(t.app)
        .put(api(`/payroll/runs/2026-11/payslips/${mia.id}`))
        .set(kai.auth)
        .send({
          lines: [{ section: 'BONUS', label: 'Thưởng kênh', amount: BONUS }],
          note: null,
          overrideHalfDays: null,
          overrideReason: null,
          expectedLockVersion: slip.lockVersion,
        });

      expect(res.status).toBe(500);
      expect(leaksMoney(res.text)).toEqual([]);
      const log = lines.join('\n');
      expect(log).toMatch(/"level":"error"/); // lỗi 5xx CÓ được log (không nuốt lỗi) …
      expect(leaksMoney(log)).toEqual([]); // … nhưng không mang số tiền
      expect(log).not.toContain('Thưởng kênh'); // body không vào log
    },
  );

  it('Sentry: event của chính các lỗi đó (allow-list + scrub) không có số tiền', () => {
    for (const message of DB_ERRORS) {
      const err = new Error(message);
      const event = {
        message,
        exception: { values: [{ type: 'Error', value: message }] },
        request: { data: JSON.stringify({ baseSalary: BASE, lines: [{ amount: BONUS }] }) },
        extra: { body: { baseSalary: BASE } },
      } as unknown as ErrorEvent;
      const safe = JSON.stringify(sanitizeErrorEvent(event, { originalException: err }));
      expect(leaksMoney(safe)).toEqual([]);
    }
  });
});
