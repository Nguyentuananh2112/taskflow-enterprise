import { randomUUID } from 'node:crypto';

import { describe, expect } from 'vitest';

import { useCompanyApi, type CompanyActor } from './harness/company';
import { addDays } from './harness/clock';
import { HR, accessVersion, hrClockEnv, todayVn, withKey, workday } from './harness/hr';
import { errorEnvelope, type RawResponse } from './harness/http-client';
import { secCase } from './harness/suite';
import { flushRateLimitCounters } from './harness/valkey';

// CC-HR-16…19, 26, 27 (test-spec-company §4, T-066 — F): đua HỘP ĐEN qua HTTP + Postgres thật, ×RUNS mỗi ca, gom
// vòng đỏ rồi mới đánh giá (như CC-HR-02). Bất biến: không 5xx, đúng một bên thắng, trạng thái cuối nhất quán.

const { api, actors } = useCompanyApi(hrClockEnv());
const RUNS = (() => {
  const raw = process.env.SEC_HR_RACE_RUNS;
  if (raw === undefined) return 20;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1)
    throw new Error(`SEC_HR_RACE_RUNS phải là số nguyên ≥ 1, nhận "${raw}"`);
  return n;
})();
const TIMEOUT = 240_000 * Math.max(1, Math.ceil(RUNS / 20));
const AREA = 'Mốc 3.5 races';
const statuses = (rs: RawResponse[]) => rs.map((r) => r.status).sort((a, b) => a - b);
const no5xx = (rs: RawResponse[]) => rs.every((r) => r.status < 500);
const YESTERDAY = () => addDays(todayVn(), -1);

/** Mỗi vòng Ada thêm vài người (30/giờ/actor) ⇒ xóa bộ đếm trước vòng (không phải dữ liệu nghiệp vụ). */
async function round() {
  await flushRateLimitCounters();
}

describe('Chấm công / tài khoản song song', () => {
  secCase(
    'CC-HR-16',
    'Mia check-in 2 tab: khác key ⇒ 201 + 409 already_checked_in; cùng key ⇒ 201 + 200 replay; luôn đúng 1 IN',
    AREA,
    async () => {
      const red: string[] = [];
      for (let i = 0; i < RUNS; i += 1) {
        await round();
        const [a, b] = await Promise.all([
          actors.createUser('cc16-a'),
          actors.createUser('cc16-b'),
        ]);
        const diff = await Promise.all([
          withKey(api, 'POST', HR.checkIn, a.accessToken),
          withKey(api, 'POST', HR.checkIn, a.accessToken),
        ]);
        const key = randomUUID();
        const same = await Promise.all([
          withKey(api, 'POST', HR.checkIn, b.accessToken, key),
          withKey(api, 'POST', HR.checkIn, b.accessToken, key),
        ]);
        const loser = diff.find((r) => r.status === 409);
        const reason = loser
          ? (errorEnvelope(loser).error.details as { reason?: string } | null)?.reason
          : undefined;
        const ins = async (who: CompanyActor) =>
          (
            (await actors.json('GET', HR.myEvents(todayVn()), who.accessToken)).json as {
              data: { events: { kind: string; voidedAt: string | null }[] };
            }
          ).data.events.filter((e) => e.kind === 'IN' && e.voidedAt === null).length;
        const tag = `#${String(i)}: khác key [${statuses(diff).join(',')}] ${String(reason)}; cùng key [${statuses(same).join(',')}]`;
        if (
          statuses(diff).join() !== '201,409' ||
          reason !== 'already_checked_in' ||
          statuses(same).join() !== '200,201' ||
          (await ins(a)) !== 1 ||
          (await ins(b)) !== 1
        )
          red.push(tag);
      }
      expect(red, `${String(red.length)}/${String(RUNS)} vòng đỏ`).toEqual([]);
    },
    TIMEOUT,
  );

  secCase(
    'CC-HR-17',
    'Hai Admin hạ nhau song song (chỉ còn hai Admin) ⇒ đúng 1 thành công; luôn còn ≥ 1 Admin; không 5xx',
    AREA,
    async () => {
      // Bất biến của đặc tả: đúng một bên thắng, luôn còn ≥ 1 Admin. Mã bên thua phụ thuộc thứ tự khóa
      // (`lockAdmins` tuần tự hóa): bên thua đã mất quyền ⇒ 403 (hoặc 401 nếu tới sau khi phiên bị thu hồi); cùng
      // lúc hai bên vượt kiểm quyền ⇒ 409 `last_admin`. Bên thắng là Admin duy nhất ⇒ thành `actors.ada` cho vòng sau.
      const red: string[] = [];
      for (let i = 0; i < RUNS; i += 1) {
        await round();
        const boss = actors.ada;
        const other = await actors.createUser('cc17-admin', { admin: true });
        const admins = async () =>
          (
            (await actors.json('GET', HR.access, actors.ada.accessToken)).json as {
              data: { userId: string; role: string }[];
            }
          ).data.filter((r) => r.role === 'ADMIN');
        // Chỉ còn đúng 2 Admin (boss + other) — các vòng trước luôn để lại đúng 1.
        expect((await admins()).length, `#${String(i)}: trước vòng`).toBe(2);
        const [vBoss, vOther] = await Promise.all([
          accessVersion(actors, boss.userId),
          accessVersion(actors, other.userId),
        ]);
        const demote = (by: CompanyActor, target: CompanyActor, expectedVersion: number) =>
          actors.json('PUT', HR.accessOf(target.userId), by.accessToken, {
            role: 'EMPLOYEE',
            grants: [],
            expectedVersion,
          });
        const rs = await Promise.all([demote(boss, other, vOther), demote(other, boss, vBoss)]);
        const wins = rs.filter((r) => r.status === 200).length;
        const winner = rs[0]?.status === 200 ? boss : other;
        if (wins === 1) actors.ada = winner;
        const left = wins === 1 ? await admins() : [];
        const losers = rs.filter((r) => r.status !== 200).map((r) => r.status);
        if (
          wins !== 1 ||
          !no5xx(rs) ||
          !losers.every((s) => [401, 403, 409].includes(s)) ||
          left.length !== 1 ||
          left[0]?.userId !== winner.userId
        )
          red.push(`#${String(i)}: [${statuses(rs).join(',')}] Admin còn ${String(left.length)}`);
        if (wins !== 1) break; // trạng thái không xác định — vòng sau không còn ý nghĩa
      }
      expect(red, `${String(red.length)} vòng đỏ`).toEqual([]);
    },
    TIMEOUT,
  );

  secCase(
    'CC-HR-19',
    '2 activate cùng token ⇒ một 200 + một 410; 2 thêm nhân viên cùng email ⇒ 201 + 409 already_employee',
    AREA,
    async () => {
      const hana = await actors.createUser('cc19-hana', { grants: ['HR_MANAGE'] });
      const red: string[] = [];
      for (let i = 0; i < RUNS; i += 1) {
        await round();
        const nina = await actors.createUser('cc19-nina', { pending: true });
        const act = await Promise.all(
          [0, 1].map(() =>
            actors.json('POST', '/auth/activate', undefined, {
              token: nina.token,
              password: 'cc19-mat-khau-du-dai-9',
            }),
          ),
        );
        const email = `cc19-${randomUUID()}@sec.example`;
        const hires = await Promise.all(
          [0, 1].map(() => actors.hire(hana, { email, fullName: 'Sec CC19' })),
        );
        const dup = hires.find((r) => r.status === 409);
        const reason = dup
          ? (errorEnvelope(dup).error.details as { reason?: string } | null)?.reason
          : undefined;
        if (
          statuses(act).join() !== '200,410' ||
          statuses(hires).join() !== '201,409' ||
          reason !== 'already_employee'
        )
          red.push(
            `#${String(i)}: activate [${statuses(act).join(',')}] hire [${statuses(hires).join(',')}] ${String(reason)}`,
          );
      }
      expect(red, `${String(red.length)}/${String(RUNS)} vòng đỏ`).toEqual([]);
    },
    TIMEOUT,
  );
});

describe('Nghỉ việc song song', () => {
  /** Mia có lịch nghỉ ngày mai (để DELETE có gì hủy); nhiệm kỳ từ 3 ngày trước (lastDay ≥ startDate). */
  async function scheduled(hana: CompanyActor, label: string) {
    const mia = await actors.createUser(label, { startDate: addDays(todayVn(), -3) });
    const put = await actors.offboardRaw(hana, mia.userId, addDays(todayVn(), 1));
    expect(put.status, put.text.slice(0, 160)).toBe(200);
    return mia;
  }
  const statusOf = async (hana: CompanyActor, who: CompanyActor) => {
    const res = await actors.json(
      'GET',
      `/hr/employees?q=${encodeURIComponent(who.email)}`,
      hana.accessToken,
    );
    const left = await actors.json(
      'GET',
      `/hr/employees?status=left&q=${encodeURIComponent(who.email)}`,
      hana.accessToken,
    );
    const rows = [
      ...(res.json as { data: { userId: string; status: string }[] }).data,
      ...(left.json as { data: { userId: string; status: string }[] }).data,
    ].filter((r) => r.userId === who.userId);
    return rows.map((r) => r.status);
  };

  secCase(
    'CC-HR-18',
    'PUT offboarding lastDay quá khứ (hoàn tất trong request) ‖ Hana DELETE offboarding ‖ Mia chấm công ⇒ không 5xx; cuối cùng LEFT (đúng 1 dòng) hoặc còn làm, không nửa vời',
    AREA,
    async () => {
      // Vế "‖ job hoàn tất" và "chấm Ra 05:59:59" cần đồng hồ neo ⇒ company-clock-0559 (D). Ở đây: đua trong request.
      const hana = await actors.createUser('cc18-hana', { grants: ['HR_MANAGE'] });
      const red: string[] = [];
      for (let i = 0; i < RUNS; i += 1) {
        await round();
        const mia = await scheduled(hana, 'cc18-mia');
        const rs = await Promise.all([
          actors.offboardRaw(hana, mia.userId, YESTERDAY()),
          actors.json('DELETE', `/hr/employees/${mia.userId}/offboarding`, hana.accessToken),
          withKey(api, 'POST', HR.checkIn, mia.accessToken),
        ]);
        const final = await statusOf(hana, mia);
        const done = rs[0]?.status === 200;
        // Hoàn tất thắng ⇒ LEFT đúng một dòng; DELETE thắng trước ⇒ PUT vẫn có thể hoàn tất sau (lịch mới) ⇒ LEFT;
        // nếu PUT bị từ chối (409/422) ⇒ còn làm (ACTIVE, không lịch).
        const ok =
          no5xx(rs) &&
          final.length === 1 &&
          (done ? final[0] === 'LEFT' : final[0] === 'ACTIVE' || final[0] === 'OFFBOARDING');
        if (!ok) {
          const putBody = (rs[0]?.json as { data?: { employee?: { status?: string } } } | undefined)
            ?.data?.employee?.status;
          const delBody = rs[1]?.text.slice(0, 160);
          red.push(
            `#${String(i)}: [${rs.map((r) => r.status).join(',')}] PUT→${String(putBody)} DELETE→${String(delBody)} cuối ${JSON.stringify(final)}`,
          );
        }
      }
      expect(red, `${String(red.length)}/${String(RUNS)} vòng đỏ`).toEqual([]);
    },
    TIMEOUT,
  );

  secCase(
    'CC-HR-26',
    'Hoàn tất nghỉ việc ‖ Mia gửi đơn ⇒ sau hoàn tất không còn đơn PENDING nào sau lastDay của Mia',
    AREA,
    async () => {
      const hana = await actors.createUser('cc26-hana', { grants: ['HR_MANAGE'] });
      const pendingOf = async (userId: string) => {
        let cursor: string | null = null;
        let n = 0;
        for (let page = 0; page < 50; page += 1) {
          const qs: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
          const res = await actors.json(
            'GET',
            `${HR.leaveRequests}?status=PENDING&limit=100${qs}`,
            hana.accessToken,
          );
          expect(res.status, res.text.slice(0, 160)).toBe(200);
          const body = res.json as {
            data: unknown[];
            meta: { page?: { nextCursor: string | null } };
          };
          n += body.data.filter((r) => JSON.stringify(r).includes(userId)).length;
          cursor = body.meta.page?.nextCursor ?? null;
          if (!cursor) return n;
        }
        throw new Error('quá 50 trang đơn PENDING');
      };
      const red: string[] = [];
      for (let i = 0; i < RUNS; i += 1) {
        await round();
        const mia = await actors.createUser('cc26-mia', { startDate: addDays(todayVn(), -3) });
        const day = workday(10 + 2 * (i % 5));
        const rs = await Promise.all([
          actors.offboardRaw(hana, mia.userId, YESTERDAY()),
          actors.json('POST', HR.leaveRequests, mia.accessToken, {
            type: 'UNPAID',
            startDate: day,
            endDate: day,
            dayPart: 'FULL',
          }),
        ]);
        const left = await pendingOf(mia.userId);
        if (!no5xx(rs) || rs[0]?.status !== 200 || left !== 0)
          red.push(
            `#${String(i)}: [${rs.map((r) => r.status).join(',')}] còn ${String(left)} đơn PENDING`,
          );
      }
      expect(red, `${String(red.length)}/${String(RUNS)} vòng đỏ`).toEqual([]);
    },
    TIMEOUT,
  );

  secCase(
    'CC-HR-27',
    'Workspace mồ côi: Ada giao OWNER cho hai thành viên song song ⇒ đúng một OWNER (bên kia 409 workspace_has_owner), không 5xx',
    AREA,
    async () => {
      // Đặc tả: "owner ‖ OWNER cũ được thêm lại". ws mồ côi không còn ai có member:add ⇒ "thêm lại" chỉ đi qua
      // `admin/workspaces/:id/owner` ⇒ đua hai lệnh giao OWNER (bất biến "đúng một OWNER" như nhau).
      const hana = await actors.createUser('cc27-hana', { grants: ['HR_MANAGE'] });
      const red: string[] = [];
      for (let i = 0; i < RUNS; i += 1) {
        await round();
        const owner = await actors.createUser('cc27-owner', { startDate: addDays(todayVn(), -3) });
        const [x, y] = await Promise.all([
          actors.createUser('cc27-x'),
          actors.createUser('cc27-y'),
        ]);
        const ws = await actors.newWorkspace(owner, `CC27 ${randomUUID().slice(0, 8)}`);
        await actors.addToWorkspace(owner, ws.id, x.userId, 'MEMBER');
        await actors.addToWorkspace(owner, ws.id, y.userId, 'MEMBER');
        const off = await actors.offboardRaw(hana, owner.userId, YESTERDAY());
        expect(off.status, off.text.slice(0, 160)).toBe(200);
        const give = (who: CompanyActor) =>
          actors.json('POST', `/admin/workspaces/${ws.id}/owner`, actors.ada.accessToken, {
            userId: who.userId,
          });
        const rs = await Promise.all([give(x), give(y)]);
        const loser = rs.find((r) => r.status === 409);
        const reason = loser
          ? (errorEnvelope(loser).error.details as { reason?: string } | null)?.reason
          : undefined;
        const list = (await actors.json('GET', '/admin/workspaces', actors.ada.accessToken))
          .json as {
          data: { id: string; owners: { id: string }[]; orphan: boolean }[];
        };
        const row = list.data.find((w) => w.id === ws.id);
        if (
          statuses(rs).join() !== '200,409' ||
          reason !== 'workspace_has_owner' ||
          row?.owners.length !== 1 ||
          row.orphan
        )
          red.push(
            `#${String(i)}: [${statuses(rs).join(',')}] ${String(reason)} owners ${String(row?.owners.length)}`,
          );
      }
      expect(red, `${String(red.length)}/${String(RUNS)} vòng đỏ`).toEqual([]);
    },
    TIMEOUT,
  );
});
