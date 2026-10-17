import { FakeClock, FakeUnitOfWork, SequentialIdGenerator } from '../../../../test/support';
import { ForbiddenError } from '../../../core/errors';
import type { PayrollDeps } from '../application/payroll-kit';
import type {
  IPayrollNotifier,
  PayrollAuditAction,
  PayrollDaysResult,
} from '../application/ports/collaborators.port';
import { InMemoryPayrollStore } from '../infrastructure/in-memory/in-memory-payroll.store';

/** Bối cảnh chuẩn (payroll.md §7): Kai Kế toán, Olivia Admin (không có phiếu), Mia / Max nhân viên. */
export const KAI = '0199e5a2-0000-7000-8000-00000000a001';
export const OLIVIA = '0199e5a2-0000-7000-8000-00000000a000';
export const MIA = '0199e5a2-0000-7000-8000-00000000b001';
export const MAX = '0199e5a2-0000-7000-8000-00000000b002';
export const NAMES: Record<string, string> = {
  [KAI]: 'Kai',
  [OLIVIA]: 'Olivia',
  [MIA]: 'Mia',
  [MAX]: 'Max',
};

/** Ngày đầu tháng 12/2026 10:00 giờ VN — kỳ 2026-11 đã kết thúc. */
export const NOW = '2026-12-01T03:00:00.000Z';

export function createPayrollHarness(now = NOW) {
  const store = new InMemoryPayrollStore();
  const clock = new FakeClock(now);
  /** Người có `payroll:manage` HIỆN TẠI. */
  const managers = new Set([KAI, OLIVIA]);
  const hireDates = new Map<string, string | null>([
    [KAI, '2020-01-15'],
    [MIA, '2023-11-30'],
    [MAX, null],
  ]);
  /** Người trong kỳ (đoạn EMPLOYEE giao tháng) + công từng người; mặc định đủ công 25 ngày. */
  const members = [KAI, MIA, MAX];
  const days = new Map<string, PayrollDaysResult>(
    members.map((u) => [u, { ok: true, halfDays: 50, missingOutDates: [], sickDays: 0 }]),
  );
  const att = { standardDays: 25, noWorkdays: false };
  const audit: { action: PayrollAuditAction; actorId: string; after: unknown }[] = [];
  const sent: Parameters<IPayrollNotifier['notify']>[0][] = [];
  const company = { name: 'Công ty Bịa' as string | null };
  const deps: PayrollDeps = {
    store,
    access: {
      authorizeWrite: ({ actorId, targetUserId }) =>
        managers.has(actorId) && targetUserId !== actorId
          ? Promise.resolve()
          : Promise.reject(new ForbiddenError('payroll:manage')),
    },
    hireDates: {
      hireDates: ({ userIds }) =>
        Promise.resolve(new Map(userIds.map((u) => [u, hireDates.get(u) ?? null]))),
    },
    attendance: {
      payrollDaysFor: ({ userIds }) => {
        return Promise.resolve({
          standardDays: att.noWorkdays ? 0 : att.standardDays,
          byUser: new Map(
            userIds.map((u) => [
              u,
              days.get(u) ?? { ok: true, halfDays: 0, missingOutDates: [], sickDays: 0 },
            ]),
          ),
        });
      },
      payrollMembersOf: () => Promise.resolve([...members].sort()),
    },
    users: {
      findRefs: (ids) =>
        Promise.resolve(
          new Map(ids.filter((id) => NAMES[id]).map((id) => [id, { id, fullName: NAMES[id]! }])),
        ),
    },
    audit: {
      record: (e) => {
        if (e.after && 'reason' in e.after)
          return Promise.reject(new Error("HrAuditLog không được chứa 'reason'"));
        audit.push({ action: e.action, actorId: e.actorId, after: e.after ?? null });
        return Promise.resolve();
      },
    },
    notifier: {
      notify: (n) => {
        sent.push(n);
        return Promise.resolve();
      },
      notifyOnce: (n) => {
        if (sent.some((s) => s.type === n.type && s.refId === n.refId))
          return Promise.resolve(false);
        sent.push(n);
        return Promise.resolve(true);
      },
    },
    company: { companyName: () => Promise.resolve(company.name) },
    timeZoneNow: () => Promise.resolve('Asia/Ho_Chi_Minh'),
    uow: new FakeUnitOfWork(),
    clock,
    ids: new SequentialIdGenerator(),
  };
  /** Thêm phiên bản hồ sơ lương trực tiếp (dữ liệu nền). */
  const profile = (userId: string, effectiveFrom: string, baseSalary: number, level = 'L1') =>
    store.insertProfile({
      id: deps.ids.next(),
      userId,
      effectiveFrom,
      level,
      baseSalary,
      createdById: OLIVIA,
      createdAt: new Date(0),
    });
  return {
    deps,
    store,
    clock,
    managers,
    hireDates,
    members,
    days,
    att,
    audit,
    sent,
    company,
    profile,
  };
}
