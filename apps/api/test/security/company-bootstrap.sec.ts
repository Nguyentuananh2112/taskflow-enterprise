import { randomUUID } from 'node:crypto';

import { describe, expect } from 'vitest';

import { useCompanyApi } from './harness/company';
import { loadHarnessConfig, postgresUrl } from './harness/config';
import { baseEnv } from './harness/suite-env';
import { bootstrapEnv, runBootstrapRaw } from './harness/company-bootstrap';
import { secCase } from './harness/suite';

// SEC-HR-64 + SEC-HR-64c (test-spec-company §3; ADR-137, R38): CLI `admin:bootstrap` gọi trực tiếp (runBootstrapRaw —
// stdin `ignore` ⇒ KHÔNG có TTY), không qua API. Hộp đen tuyệt đối (ADR-140): không chèn / đọc DB — "không ghi gì" kiểm
// bằng hành vi công khai qua Ada (Admin do bootstrap của suite tạo): danh sách quyền `admin/access`, `hr/employees?q=`,
// Ada vẫn đăng nhập được. SEC-HR-64b (nâng nhân viên sẵn có — trạng thái chỉ do backfill tạo ra) ở tầng I:
// test/integration/company/admin-bootstrap-upgrade.int.ts.

const { actors } = useCompanyApi();
const AREA = 'Mốc 3.5 — admin:bootstrap';

/** Cùng DB / Valkey với API dưới test — `prepareSuiteDatabase` trả đúng `postgresUrl(config, 'app')`. */
const env = () => baseEnv(postgresUrl(loadHarnessConfig(), 'app'));

interface AccessRow {
  userId: string;
  email: string;
  role: string;
}
async function accessRows(): Promise<AccessRow[]> {
  const res = await actors.json('GET', '/admin/access', actors.ada.accessToken);
  expect(res.status, res.text.slice(0, 200)).toBe(200);
  return (res.json as { data: AccessRow[] }).data;
}
async function knownEmail(email: string): Promise<boolean> {
  return (await accessRows()).some((r) => r.email === email);
}

describe('admin:bootstrap', () => {
  secCase(
    'SEC-HR-64',
    'thiếu từng env ⇒ thoát 2, không ghi gì; không TTY / --json ngoài APP_ENV=test ⇒ từ chối',
    AREA,
    async () => {
      const before = await accessRows();
      const email = `x-${randomUUID()}@sec.example`;
      const ok = bootstrapEnv(env(), { email, name: 'Sec X', company: 'Sec Co' });
      for (const missing of ['BOOTSTRAP_ADMIN_EMAIL', 'BOOTSTRAP_ADMIN_NAME', 'COMPANY_NAME']) {
        const res = await runBootstrapRaw({ ...ok, [missing]: '' }, ['--json']);
        expect(res.code, `${missing}: ${res.stderr}`).toBe(2);
        expect(res.stderr).toContain(missing);
        expect(res.stdout.trim()).toBe('');
      }
      const notTest = await runBootstrapRaw({ ...ok, APP_ENV: 'local' }, ['--json']);
      expect(notTest.code, notTest.stderr).toBe(2);
      expect(notTest.stderr).toContain('--json chỉ dùng được khi APP_ENV=test');
      for (const appEnv of ['test', 'local']) {
        // Không `--json` ⇒ bắt buộc tương tác; stdin `ignore` không phải TTY.
        const res = await runBootstrapRaw({ ...ok, APP_ENV: appEnv }, []);
        expect(res.code, res.stderr).toBe(2);
        expect(res.stderr).toContain('Chỉ chạy tương tác (TTY)');
      }
      expect(await accessRows()).toEqual(before);
      expect(await knownEmail(email)).toBe(false);
    },
  );

  secCase(
    'SEC-HR-64c',
    'đã có Admin kích hoạt: chạy lần 2 (email khác) ⇒ thoát 1 "Đã có Admin", không đổi gì; --reissue-link ⇒ thoát 1',
    AREA,
    async () => {
      const before = await accessRows();
      const email = `second-${randomUUID()}@sec.example`;
      const again = await runBootstrapRaw(
        bootstrapEnv(env(), { email, name: 'Sec Second', company: 'Khác' }),
        ['--json'],
      );
      expect(again.code, again.stderr).toBe(1);
      expect(again.stderr).toContain('Đã có Admin');
      expect(again.stdout.trim()).toBe('');

      const reissue = await runBootstrapRaw(
        bootstrapEnv(env(), { email: actors.bootstrap.email, name: 'Sec Ada' }),
        ['--json', '--reissue-link'],
      );
      expect(reissue.code, reissue.stderr).toBe(1);
      expect(reissue.stderr).toContain('Đã có Admin kích hoạt');
      expect(reissue.stdout.trim()).toBe('');

      expect(await accessRows()).toEqual(before);
      expect(await knownEmail(email)).toBe(false);
      expect(before.filter((r) => r.role === 'ADMIN').map((r) => r.userId)).toEqual([
        actors.ada.userId,
      ]);
      // Ada vẫn đăng nhập được, tên công ty không đổi.
      expect((await actors.login(actors.ada)).userId).toBe(actors.ada.userId);
      const company = await actors.json('GET', '/company', actors.ada.accessToken);
      expect((company.json as { data: { name: string } }).data.name).toBe('Sec Company');
    },
  );
});
