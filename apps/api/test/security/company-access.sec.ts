import {
  CompanyPermission,
  type AccessDto,
  type AdminWorkspaceDto,
} from '@taskflow/contracts/company';
import { beforeAll, describe, expect } from 'vitest';

import { addDays } from './harness/clock';
import { useCompanyApi, type CompanyActor } from './harness/company';
import {
  HR,
  hrClockEnv,
  leaveOf,
  submitLeave,
  thisMonth,
  todayVn,
  withKey,
  workday,
} from './harness/hr';
import { errorEnvelope, type RawResponse } from './harness/http-client';
import { secCase } from './harness/suite';

// Mốc 3.5 — quyền cấp công ty (docs/design/test-spec-company.md §3): SEC-HR-30…35, 38, 65. Hộp đen: API thật + DB riêng
// của file; mọi người do Ada (bootstrap) thêm qua `POST hr/employees` (ADR-140). Thứ tự lỗi ADR-135: 401 → 401
// SESSION_REVOKED → 403 (permit TRƯỚC validate) → 400 → 404 → 422/409. Ca đổi trạng thái tạo người mới (§0.4).

const { api, actors } = useCompanyApi(hrClockEnv());
const AREA = 'Mốc 3.5 cấp công ty (T-061/T-061a/T-062)';
const TODAY = todayVn();

let mia: CompanyActor; // nhân viên
let max: CompanyActor; // nhân viên
let hana: CompanyActor; // nhân viên + HR_MANAGE
let kay: CompanyActor; // nhân viên + PAYROLL_MANAGE

beforeAll(async () => {
  mia = await actors.createUser('mia');
  max = await actors.createUser('max');
  hana = await actors.createUser('hana', { grants: ['HR_MANAGE'] });
  kay = await actors.createUser('kay', { grants: ['PAYROLL_MANAGE'] });
}, 120_000);

const call = (who: CompanyActor, method: string, path: string, body?: unknown) =>
  actors.json(method, path, who.accessToken, body);

const expectStatus = (res: RawResponse, status: number, what: string) =>
  expect(res.status, `${what}: ${res.text.slice(0, 300)}`).toBe(status);
const detailsOf = (res: RawResponse) => errorEnvelope(res).error.details;

interface MeCompany {
  role: 'ADMIN' | 'EMPLOYEE';
  grants: string[];
  permissions: string[];
}
async function meCompany(who: CompanyActor): Promise<MeCompany> {
  const res = await call(who, 'GET', '/auth/me');
  expectStatus(res, 200, `GET /auth/me ${who.email}`);
  return (res.json as { data: { company: MeCompany } }).data.company;
}

async function accessOf(userId: string): Promise<AccessDto> {
  const res = await call(actors.ada, 'GET', HR.access);
  expectStatus(res, 200, 'GET admin/access');
  const row = (res.json as { data: AccessDto[] }).data.find((r) => r.userId === userId);
  if (!row) throw new Error(`không thấy ${userId} trong admin/access`);
  return row;
}

describe('Leo quyền / tách quyền (ADR-134/135)', () => {
  secCase(
    'SEC-HR-30',
    'Nhân viên / HR / Kế toán tự nâng mình hoặc người khác qua admin/access ⇒ 403 (body sai vẫn 403); HR thêm nhân viên kèm role ⇒ 400; /auth/me không đổi',
    AREA,
    async () => {
      const before = await Promise.all([mia, hana, kay].map(meCompany));
      for (const who of [mia, hana, kay]) {
        for (const target of [who, max]) {
          const version = (await accessOf(target.userId)).version;
          for (const body of [
            { role: 'ADMIN', grants: [], expectedVersion: version },
            { role: 'EMPLOYEE', grants: ['HR_MANAGE'], expectedVersion: version },
            { role: 'BOSS', nonsense: true },
          ]) {
            const res = await call(who, 'PUT', HR.accessOf(target.userId), body);
            expectStatus(res, 403, `${who.email} → ${target.email}`);
            expect(detailsOf(res)).toEqual({ required: 'company:grant' });
          }
        }
      }
      const withRole = await actors.json('POST', '/hr/employees', hana.accessToken, {
        email: `role-${Date.now()}@sec.example`,
        fullName: 'Có role',
        role: 'ADMIN',
      });
      expectStatus(withRole, 400, 'POST hr/employees có role');
      expect(await Promise.all([mia, hana, kay].map(meCompany))).toEqual(before);
    },
  );

  secCase(
    'SEC-HR-31',
    'HR cấp / thu grant, nâng Admin, cho nghỉ / tạo lại link cho Ada, chính mình, người giữ grant ⇒ 403; Ada làm được',
    AREA,
    async () => {
      const maxV = (await accessOf(max.userId)).version;
      for (const body of [
        { role: 'EMPLOYEE', grants: ['HR_MANAGE'], expectedVersion: maxV },
        { role: 'EMPLOYEE', grants: ['PAYROLL_MANAGE'], expectedVersion: maxV },
        { role: 'ADMIN', grants: [], expectedVersion: maxV },
      ]) {
        expectStatus(
          await call(hana, 'PUT', HR.accessOf(max.userId), body),
          403,
          'HR đổi quyền Max',
        );
      }
      expectStatus(
        await call(hana, 'PUT', HR.accessOf(kay.userId), {
          role: 'EMPLOYEE',
          grants: [],
          expectedVersion: (await accessOf(kay.userId)).version,
        }),
        403,
        'HR thu grant của Kay',
      );
      const lastDay = addDays(TODAY, 30);
      for (const target of [actors.ada, hana, kay]) {
        expectStatus(
          await actors.offboardRaw(hana, target.userId, lastDay),
          403,
          `HR cho nghỉ ${target.email}`,
        );
        expectStatus(
          await call(hana, 'POST', `/hr/employees/${target.userId}/activation-link`, {}),
          403,
          `HR tạo lại link ${target.email}`,
        );
      }
      expect((await accessOf(max.userId)).version).toBe(maxV);

      // Ada làm được cùng lệnh: cấp / thu grant của Max, lên lịch nghỉ cho Kay (rồi hủy), tạo lại link người chờ kích hoạt.
      const granted = await actors.setAccess(actors.ada, max.userId, {
        role: 'EMPLOYEE',
        grants: ['PAYROLL_MANAGE'],
        expectedVersion: maxV,
      });
      expect(granted.grants).toEqual(['PAYROLL_MANAGE']);
      await actors.setAccess(actors.ada, max.userId, {
        role: 'EMPLOYEE',
        grants: [],
        expectedVersion: granted.version,
      });
      const offboard = await actors.offboard(actors.ada, kay.userId, lastDay);
      expect(offboard.employee).toMatchObject({ status: 'OFFBOARDING', offboardLastDay: lastDay });
      expectStatus(
        await call(actors.ada, 'DELETE', `/hr/employees/${kay.userId}/offboarding`),
        200,
        'Ada hủy lịch nghỉ Kay',
      );
      const nina = await actors.createUser('nina-31', { pending: true });
      const activation = await actors.reissueActivation(actors.ada, nina.userId);
      expect(activation.link).toContain('/activate#t=');
    },
  );

  // Qua route, người gọi luôn là một Admin khác ⇒ "Admin cuối" chỉ xảy ra khi Admin còn lại đã có lịch nghỉ (fix
  // T-061a e8e0fbd: Admin có `offboardLastDay` không tính là "ở lại"). Bước 200 dùng Ada hạ Ada2 thay vì Ada2 hạ
  // Ada để Ada (bootstrap) giữ phiên Admin cho các ca sau.
  secCase(
    'SEC-HR-32',
    'Admin tự hạ / tự cho mình nghỉ ⇒ 403; hạ Admin khi Admin ở lại duy nhất đang có lịch nghỉ ⇒ 409 last_admin; còn Admin ở lại ⇒ 200',
    AREA,
    async () => {
      const ada2 = await actors.createUser('ada2', { admin: true });
      expectStatus(
        await call(actors.ada, 'PUT', HR.accessOf(actors.ada.userId), {
          role: 'EMPLOYEE',
          grants: [],
          expectedVersion: (await accessOf(actors.ada.userId)).version,
        }),
        403,
        'Ada tự hạ',
      );
      expectStatus(
        await actors.offboardRaw(actors.ada, actors.ada.userId, addDays(TODAY, 10)),
        403,
        'Ada tự cho nghỉ',
      );
      expectStatus(
        await call(ada2, 'PUT', HR.accessOf(ada2.userId), {
          role: 'EMPLOYEE',
          grants: [],
          expectedVersion: (await accessOf(ada2.userId)).version,
        }),
        403,
        'Ada2 tự hạ',
      );

      // Ada2 lên lịch nghỉ cho Ada ⇒ Ada "sắp đi"; Ada hạ Ada2 ⇒ không còn Admin ở lại ⇒ 409.
      await actors.offboard(ada2, actors.ada.userId, addDays(TODAY, 30));
      const ada2V = (await accessOf(ada2.userId)).version;
      const last = await call(actors.ada, 'PUT', HR.accessOf(ada2.userId), {
        role: 'EMPLOYEE',
        grants: [],
        expectedVersion: ada2V,
      });
      expectStatus(last, 409, 'hạ Admin cuối');
      expect(detailsOf(last)).toMatchObject({ reason: 'last_admin' });
      expect((await accessOf(ada2.userId)).role).toBe('ADMIN');

      // Hủy lịch của Ada ⇒ Ada ở lại ⇒ hạ Ada2 được.
      expectStatus(
        await call(ada2, 'DELETE', `/hr/employees/${actors.ada.userId}/offboarding`),
        200,
        'Ada2 hủy lịch nghỉ Ada',
      );
      const demoted = await call(actors.ada, 'PUT', HR.accessOf(ada2.userId), {
        role: 'EMPLOYEE',
        grants: [],
        expectedVersion: ada2V,
      });
      expectStatus(demoted, 200, 'hạ Ada2 khi còn Ada');
      expect((await accessOf(actors.ada.userId)).role).toBe('ADMIN');
    },
  );

  // Tuần tự: thu rồi mới gọi. Vế "lệnh ghi đang chờ khóa lúc thu" phủ ở CC-HR-11 (hr-races.sec: thu grant ‖ approve ×20).
  secCase(
    'SEC-HR-33',
    'Thu HR_MANAGE ⇒ CÙNG access token: đọc 403 ngay, ghi (duyệt đơn) 403 và không ghi gì',
    AREA,
    async () => {
      const hr2 = await actors.createUser('hr2', { grants: ['HR_MANAGE'] });
      expectStatus(await call(hr2, 'GET', HR.today), 200, 'HR đọc trước khi thu');
      const submitted = await submitLeave(actors, mia, {
        type: 'UNPAID',
        startDate: workday(14),
        endDate: workday(14),
      });
      expectStatus(submitted, 201, 'Mia xin nghỉ');
      const { id: requestId, version } = leaveOf(submitted);
      await actors.setAccess(actors.ada, hr2.userId, {
        role: 'EMPLOYEE',
        grants: [],
        expectedVersion: (await accessOf(hr2.userId)).version,
      });
      expectStatus(await call(hr2, 'GET', HR.today), 403, 'đọc sau khi thu');
      expectStatus(
        await call(hr2, 'POST', HR.leaveAction(requestId, 'approve'), { expectedVersion: version }),
        403,
        'duyệt sau khi thu',
      );
      // Không ghi gì: đơn vẫn PENDING, version không đổi.
      const mine = await call(mia, 'GET', HR.myLeaveRequests);
      expect(
        (mine.json as { data: { id: string; status: string; version: number }[] }).data.find(
          (r) => r.id === requestId,
        ),
      ).toMatchObject({ status: 'PENDING', version });
    },
  );

  secCase(
    'SEC-HR-34',
    'Parity qua /auth/me.company.permissions: grant ∌ company:*; HR ∌ payroll:*; Kế toán ∌ hr:*; Admin ∌ *:self; chỉ quyền công ty',
    AREA,
    async () => {
      const companyOnly = new Set<string>(CompanyPermission.options);
      const [admin, employee, hr, payroll] = await Promise.all([
        meCompany(actors.ada),
        meCompany(mia),
        meCompany(hana),
        meCompany(kay),
      ]);
      for (const p of [admin, employee, hr, payroll]) {
        expect(p.permissions.filter((x) => !companyOnly.has(x))).toEqual([]);
      }
      expect(admin.role).toBe('ADMIN');
      expect(admin.permissions.filter((x) => x.endsWith(':self'))).toEqual([]);
      for (const p of [employee, hr, payroll]) {
        expect(p.role).toBe('EMPLOYEE');
        expect(p.permissions.filter((x) => x.startsWith('company:'))).toEqual([]);
      }
      expect(hr.permissions).toContain('hr:manage');
      expect(hr.permissions.filter((x) => x.startsWith('payroll:'))).toEqual([]);
      expect(payroll.permissions).toContain('payroll:manage');
      expect(payroll.permissions.filter((x) => x.startsWith('hr:'))).toEqual([]);
      expect(employee.permissions).toEqual(
        expect.arrayContaining(['attendance:self', 'leave:self']),
      );
      expect(
        employee.permissions.filter((x) => x === 'hr:manage' || x === 'payroll:manage'),
      ).toEqual([]);
    },
  );

  secCase(
    'SEC-HR-35',
    'Nhân viên gọi route hr:manage / company:admin (body sai) ⇒ 403; đọc dữ liệu người khác qua route HR ⇒ 403; HR đọc audit ⇒ 403; Admin chấm công / xin nghỉ ⇒ 403',
    AREA,
    async () => {
      const bad = { nonsense: true };
      const year = Number(TODAY.slice(0, 4));
      const routes: [string, string, unknown][] = [
        ['GET', HR.today, undefined],
        ['GET', HR.month(thisMonth()), undefined],
        ['GET', HR.exportCsv(thisMonth()), undefined],
        ['GET', HR.eventsOf(max.userId, TODAY), undefined],
        ['POST', HR.events, bad],
        ['POST', HR.schedules, bad],
        ['PUT', HR.holiday(addDays(TODAY, 40)), bad],
        ['GET', `/leave/balances?year=${year}`, undefined],
        ['PATCH', HR.balance(max.userId, year), bad],
        ['GET', '/leave/requests?status=PENDING', undefined],
        ['GET', '/hr/employees', undefined],
        ['POST', '/hr/employees', bad],
        ['PUT', `/hr/employees/${max.userId}/offboarding`, bad],
        ['POST', `/hr/employees/${max.userId}/activation-link`, bad],
        ['GET', HR.auditLogs, undefined],
        ['GET', HR.access, undefined],
        ['PUT', HR.accessOf(max.userId), bad],
        ['GET', '/admin/workspaces', undefined],
      ];
      // Gom mọi route sai rồi assert một lần ⇒ một lượt chạy thấy đủ danh sách (không dừng ở route đỏ đầu tiên).
      const red: string[] = [];
      for (const [method, path, body] of routes) {
        const res = await call(mia, method, path, body);
        if (res.status !== 403) red.push(`${method} ${path} ⇒ ${res.status}`);
      }
      expect(red).toEqual([]);
      expectStatus(await call(hana, 'GET', HR.auditLogs), 403, 'HR đọc audit');
      expectStatus(
        await withKey(api, 'POST', HR.checkIn, actors.ada.accessToken),
        403,
        'Admin chấm công',
      );
      expectStatus(
        await submitLeave(actors, actors.ada, {
          type: 'UNPAID',
          startDate: workday(20),
          endDate: workday(20),
        }),
        403,
        'Admin xin nghỉ',
      );
    },
  );
});

describe('Admin và workspace dự án (ADR-134)', () => {
  secCase(
    'SEC-HR-38',
    'Admin không có quyền ngầm vào ws; admin/workspaces không lộ dự án; giao OWNER / lưu trữ theo luật; nâng Admin giữ membership ws',
    AREA,
    async () => {
      const otto = await actors.createUser('otto');
      const w2 = await actors.newWorkspace(otto, 'Sec W2');
      expectStatus(
        await call(otto, 'POST', `/workspaces/${w2.id}/projects`, {
          name: 'Dự án mật',
          keyPrefix: 'SEC',
        }),
        201,
        'Otto tạo dự án W2',
      );
      for (const path of [`/workspaces/${w2.id}`, `/workspaces/${w2.id}/projects`]) {
        const res = await call(actors.ada, 'GET', path);
        expectStatus(res, 404, `Ada GET ${path}`);
        expect(detailsOf(res)).toEqual({ resource: 'workspace' });
      }

      // W1: Mia OWNER, Ada MEMBER tường minh ⇒ đọc được, quyền theo role ws (MEMBER không đổi tên ws).
      const w1 = await actors.newWorkspace(mia, 'Sec W1');
      await actors.addToWorkspace(mia, w1.id, actors.ada.userId, 'MEMBER');
      await actors.addToWorkspace(mia, w1.id, max.userId, 'MEMBER');
      expectStatus(await call(actors.ada, 'GET', `/workspaces/${w1.id}`), 200, 'Ada đọc W1');
      expectStatus(
        await call(actors.ada, 'PATCH', `/workspaces/${w1.id}`, { name: 'Đổi tên' }),
        403,
        'Ada (MEMBER) đổi tên W1',
      );

      // admin/workspaces: tên / OWNER / số thành viên / cờ — không project / task.
      const list = await call(actors.ada, 'GET', '/admin/workspaces');
      expectStatus(list, 200, 'admin/workspaces');
      const row2 = (list.json as { data: AdminWorkspaceDto[] }).data.find((r) => r.id === w2.id);
      expect(Object.keys(row2 ?? {}).sort()).toEqual(
        [
          'archivedAt',
          'deletedAt',
          'id',
          'memberCount',
          'members',
          'name',
          'orphan',
          'owners',
        ].sort(),
      );
      expect(row2).toMatchObject({ orphan: false, members: [], memberCount: 1 });
      expect(list.text).not.toContain('Dự án mật');

      // W3 mồ côi: Otto2 (OWNER duy nhất) nghỉ việc từ hôm qua ⇒ hoàn tất ngay ⇒ rời ws.
      const otto2 = await actors.createUser('otto2', { startDate: addDays(TODAY, -5) });
      const w3 = await actors.newWorkspace(otto2, 'Sec W3');
      await actors.addToWorkspace(otto2, w3.id, max.userId, 'MEMBER');
      const left = await actors.offboard(actors.ada, otto2.userId, addDays(TODAY, -1));
      expect(left.employee.status).toBe('LEFT');
      expect(left.warnings.soleOwnerWorkspaces.map((w) => w.id)).toContain(w3.id);
      const owner = (userId: string, wsId = w3.id) =>
        call(actors.ada, 'POST', `/admin/workspaces/${wsId}/owner`, { userId });

      const outsider = await owner(mia.userId);
      expectStatus(outsider, 422, 'giao cho người ngoài ws');
      expect(detailsOf(outsider)).toMatchObject({ rule: 'NOT_WORKSPACE_MEMBER' });
      const self = await owner(actors.ada.userId);
      expectStatus(self, 422, 'Ada tự nhận khi không là thành viên');
      expect(detailsOf(self)).toMatchObject({ rule: 'NOT_WORKSPACE_MEMBER' });
      const archive = await call(actors.ada, 'POST', `/admin/workspaces/${w3.id}/archive`, {});
      expectStatus(archive, 409, 'lưu trữ ws còn thành viên');
      expect(detailsOf(archive)).toMatchObject({ reason: 'workspace_has_members' });
      expectStatus(await owner(max.userId), 200, 'giao cho Max (thành viên)');
      const again = await owner(max.userId);
      expectStatus(again, 409, 'ws còn OWNER');
      expect(detailsOf(again)).toMatchObject({ reason: 'workspace_has_owner' });

      // Ws xóa mềm ⇒ 409 workspace_deleted.
      const w4 = await actors.newWorkspace(otto, 'Sec W4');
      await actors.addToWorkspace(otto, w4.id, max.userId, 'MEMBER');
      expectStatus(
        await call(otto, 'DELETE', `/workspaces/${w4.id}`, { confirmSlug: w4.slug }),
        200,
        'Otto xóa W4',
      );
      const deleted = await owner(max.userId, w4.id);
      expectStatus(deleted, 409, 'ws xóa mềm');
      expect(detailsOf(deleted)).toMatchObject({ reason: 'workspace_deleted' });

      // Nâng Max lên Admin ⇒ membership W1 giữ nguyên (role đổi thu hồi phiên ⇒ Mia đọc danh sách).
      await actors.setAccess(actors.ada, max.userId, {
        role: 'ADMIN',
        grants: [],
        expectedVersion: (await accessOf(max.userId)).version,
      });
      const members = await call(mia, 'GET', `/workspaces/${w1.id}/members`);
      expectStatus(members, 200, 'Mia đọc thành viên W1');
      expect(members.text).toContain(max.userId);
    },
  );
});

describe('Body strict (ADR-137)', () => {
  secCase(
    'SEC-HR-65',
    'POST hr/employees có grants / role / userId ⇒ 400; startDate tương lai / −32 ngày ⇒ 422; PUT admin/access có startDate / userId ⇒ 400',
    AREA,
    async () => {
      const email = () => `strict-${Math.random().toString(36).slice(2)}@sec.example`;
      for (const extra of [{ grants: ['HR_MANAGE'] }, { role: 'ADMIN' }, { userId: mia.userId }]) {
        expectStatus(
          await actors.hire(actors.ada, { email: email(), fullName: 'Strict', ...extra }),
          400,
          `hire + ${Object.keys(extra)[0]}`,
        );
      }
      for (const startDate of [addDays(TODAY, 1), addDays(TODAY, -32)]) {
        const res = await actors.hire(actors.ada, {
          email: email(),
          fullName: 'Strict',
          startDate,
        });
        expectStatus(res, 422, `hire startDate ${startDate}`);
        expect(detailsOf(res)).toMatchObject({ rule: 'START_DATE_OUT_OF_RANGE' });
      }
      const v = (await accessOf(mia.userId)).version;
      for (const extra of [{ startDate: TODAY }, { userId: max.userId }]) {
        expectStatus(
          await call(actors.ada, 'PUT', HR.accessOf(mia.userId), {
            role: 'EMPLOYEE',
            grants: [],
            expectedVersion: v,
            ...extra,
          }),
          400,
          `admin/access + ${Object.keys(extra)[0]}`,
        );
      }
      expect((await accessOf(mia.userId)).version).toBe(v);
    },
  );
});
