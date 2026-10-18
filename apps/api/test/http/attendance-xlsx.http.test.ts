// T-056 (hr-extended ADR-130): `GET attendance/export.xlsx` qua HTTP thật (in-process) — thứ tự lỗi (403 → 400 → 422
// trước header), header tải file, nội dung zip đọc lại bằng fflate (3 sheet, tổng là ô SỐ), trần người, audit chỉ khi
// stream bắt đầu.
import { unzipSync, strFromU8 } from 'fflate';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { errorOf } from '../support/http';
import { createTestApp, type TestApp, type TestUser } from '../support/http-app';

let t: TestApp;
let hana: TestUser; // HR
let mia: TestUser; // nhân viên

const at = (local: string) => t.clock.set(new Date(`${local.replace(' ', 'T')}:00+07:00`));
const binary = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};
const xlsx = (by: TestUser, month: string) =>
  request(t.app)
    .get(`/api/v1/attendance/export.xlsx?month=${month}`)
    .set(by.auth)
    .buffer(true)
    .parse(binary);

async function setup(overrides: Parameters<typeof createTestApp>[0] = {}) {
  t = createTestApp(overrides);
  at('2026-12-01 09:00');
  hana = await t.register('Hana', undefined, { grants: ['HR_MANAGE'], startDate: '2026-11-01' });
  mia = await t.register('Mia', undefined, { startDate: '2026-11-01' });
}

describe('GET attendance/export.xlsx', () => {
  beforeEach(() => setup());

  it('200: header tải file đúng ADR-130; zip có 3 sheet; ô tổng là SỐ; không IP / UA', async () => {
    const res = await xlsx(hana, '2026-11');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="bang-cong-2026-11.xlsx"',
    );
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    const files = unzipSync(new Uint8Array(res.body as Buffer));
    const workbook = strFromU8(files['xl/workbook.xml']!);
    for (const name of ['Tổng hợp', 'Theo ngày', 'Giờ vào – ra']) expect(workbook).toContain(name);
    const summary = strFromU8(files['xl/worksheets/sheet1.xml']!);
    expect(summary).toContain('Mia');
    expect(summary).toMatch(/<c r="C2"[^>]*><v>\d+<\/v><\/c>/); // "Ngày có đi làm" là ô số, không inlineStr
    expect(
      Object.values(files)
        .map((f) => strFromU8(f))
        .join(''),
    ).not.toMatch(/203\.0\.113|Mozilla/);
  });

  it('thứ tự lỗi: nhân viên 403 (query sai vẫn 403) → month sai 400 → tháng chưa bắt đầu 422 PERIOD_NOT_STARTED (JSON, không file)', async () => {
    expect((await xlsx(mia, '../x')).status).toBe(403);
    expect((await xlsx(hana, '2026-13')).status).toBe(400);
    const future = await request(t.app)
      .get('/api/v1/attendance/export.xlsx?month=2027-01')
      .set(hana.auth);
    expect(future.status).toBe(422);
    expect(errorOf(future)).toMatchObject({ details: { rule: 'PERIOD_NOT_STARTED' } });
  });
});

describe('trần người (ExportLimits)', () => {
  it('quá maxEmployees ⇒ 422 EXPORT_TOO_LARGE trước header, KHÔNG audit; trong trần ⇒ audit EXPORT một lần', async () => {
    await setup({
      exportLimits: { maxEmployees: 1, maxLeaveRows: 10, batchSize: 1, batchDelayMs: 0 },
    });
    const audits = async () =>
      (await t.persistence.company.hrAudit.list({ limit: 100 })).items.filter(
        (r) => r.action === 'EXPORT',
      ).length;
    const big = await request(t.app)
      .get('/api/v1/attendance/export.xlsx?month=2026-11')
      .set(hana.auth);
    expect(big.status).toBe(422);
    expect(big.headers['content-type']).toMatch(/json/);
    expect(errorOf(big)).toMatchObject({ details: { rule: 'EXPORT_TOO_LARGE' } });
    expect(await audits()).toBe(0);
    await setup({
      exportLimits: { maxEmployees: 5, maxLeaveRows: 10, batchSize: 1, batchDelayMs: 0 },
    });
    expect((await xlsx(hana, '2026-11')).status).toBe(200);
    expect(await audits()).toBe(1);
  });
});
