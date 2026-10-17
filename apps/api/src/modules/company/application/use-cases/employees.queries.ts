import type { IClock } from '../../../../core/domain';
import { toLocal, type LocalDate } from '../../../../core/domain/local-time';
import { seniorityOf } from '../../../../core/domain/seniority';
import {
  ForbiddenError,
  ResourceNotFoundError,
  SessionRevokedError,
} from '../../../../core/errors';
import type { IUnitOfWork } from '../../../../core/persistence/unit-of-work';
import type { CompanyMemberSnapshot, EmployeeStatus } from '../../domain/company-member';
import type { CompanyGrant, CompanyPermission } from '../../domain/roles';
import type { ICompanyAccounts } from '../ports/accounts.port';
import type { IProfileColumnsPort } from '../ports/employment-collaborators.port';
import type { DepartedEmployee, ICompanyOffboardingRepository } from '../ports/offboarding.port';

/** = `EmployeeDto` của contracts. */
export interface EmployeeView {
  userId: string;
  fullName: string;
  email: string;
  status: EmployeeStatus;
  grants: CompanyGrant[];
  startDate: LocalDate | null;
  offboardLastDay: LocalDate | null;
  version: number | null;
  // Mốc 5 (T-054): cột hồ sơ (không `workPhone`), thâm niên tính ở server theo "hôm nay" của giờ nghiệp vụ.
  hireDate: LocalDate | null;
  department: string | null;
  jobTitle: string | null;
  missingHireDate: boolean;
  seniority: { years: number; months: number } | null;
}

export type EmployeeStatusFilter = 'active' | 'pending' | 'offboarding' | 'left';
const STATUS_OF: Record<EmployeeStatusFilter, EmployeeStatus> = {
  active: 'ACTIVE',
  pending: 'PENDING_ACTIVATION',
  offboarding: 'OFFBOARDING',
  left: 'LEFT',
};

/** Khóa keyset `(fullName, userId)` — cùng thứ tự sắp với danh sách. */
export interface EmployeeKey {
  fullName: string;
  userId: string;
}

const collator = new Intl.Collator('vi', { sensitivity: 'base' });
const byNameThenId = (a: EmployeeKey, b: EmployeeKey) =>
  collator.compare(a.fullName, b.fullName) ||
  (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0);

/**
 * `GET /hr/employees` (`hr:manage`, thiết kế §5) — nhân viên (Admin KHÔNG phải nhân viên — ADR-134) + người đã nghỉ.
 * Trạng thái SUY RA (ADR-133). Mặc định ẩn LEFT. `q` khớp tên / email (không phân biệt hoa thường). Quy mô một công ty
 * ⇒ đọc hết rồi lọc / sắp / cắt trang trong bộ nhớ, keyset `(fullName, userId)`.
 */
export class EmployeeQueries {
  constructor(
    private readonly d: {
      offboarding: ICompanyOffboardingRepository;
      accounts: ICompanyAccounts;
      permissionsOf(userId: string): Promise<ReadonlySet<CompanyPermission> | null>;
      uow: IUnitOfWork;
      clock: IClock;
      timeZone: () => Promise<string>;
      /** Module hr-profile (T-054) — tham chiếu trễ. */
      profileColumns: () => IProfileColumnsPort;
    },
  ) {}

  async list(
    actorId: string,
    input: {
      status?: EmployeeStatusFilter | undefined;
      q?: string | undefined;
      after?: EmployeeKey | undefined;
      limit: number;
    },
  ): Promise<{ items: EmployeeView[]; nextAfter: EmployeeKey | null }> {
    await this.#authorize(actorId);
    const wanted = input.status ? STATUS_OF[input.status] : null;
    const needle = input.q?.trim().normalize('NFC').toLowerCase();
    const rows = (await this.#all())
      .filter((e) => (wanted ? e.status === wanted : e.status !== 'LEFT'))
      .filter(
        (e) =>
          !needle ||
          e.fullName.normalize('NFC').toLowerCase().includes(needle) ||
          e.email.includes(needle),
      )
      .sort(byNameThenId);
    const after = input.after;
    const start = after ? rows.filter((e) => byNameThenId(e, after) <= 0).length : 0;
    const page = rows.slice(start, start + input.limit);
    const last = page.at(-1);
    const hasMore = start + input.limit < rows.length;
    return {
      items: page,
      nextAfter: hasMore && last ? { fullName: last.fullName, userId: last.userId } : null,
    };
  }

  /**
   * Một người (response lên / hủy lịch nghỉ) — gồm cả Admin (Admin cho Admin khác nghỉ — SEC-HR-31). Không có ⇒ 404.
   */
  async one(userId: string): Promise<EmployeeView> {
    const found = (await this.#all([userId])).find((e) => e.userId === userId);
    if (!found) throw new ResourceNotFoundError('user');
    return found;
  }

  async #authorize(actorId: string): Promise<void> {
    const permissions = await this.d.permissionsOf(actorId);
    if (!permissions) throw new SessionRevokedError();
    if (!permissions.has('hr:manage')) throw new ForbiddenError('hr:manage');
  }

  async #all(only?: readonly string[]): Promise<EmployeeView[]> {
    const today = toLocal(this.d.clock.now(), await this.d.timeZone()).date;
    return this.d.uow.run(async () => {
      const keep = (id: string) => !only || only.includes(id);
      const members = only
        ? await this.d.offboarding.listMembersByIds(only)
        : await this.d.offboarding.listEmployees();
      const departed = (await this.d.offboarding.listDeparted()).filter((m) => keep(m.userId));
      const profiles = await this.d.accounts.profiles([
        ...members.map((m) => m.userId),
        ...departed.map((m) => m.userId),
      ]);
      const out: Omit<EmployeeView, ProfileColumn>[] = [];
      for (const m of members) {
        const p = profiles.get(m.userId);
        if (p && !p.deleted) out.push(currentView(m, p));
      }
      for (const m of departed) {
        const p = profiles.get(m.userId);
        if (p && !p.deleted) out.push(leftView(m, p));
      }
      const columns = await this.d.profileColumns().columnsOf(out.map((e) => e.userId));
      return out.map((e) => withProfile(e, columns.get(e.userId), today));
    });
  }
}

type Profile = { fullName: string; email: string; hasPassword: boolean };
type ProfileColumn = 'hireDate' | 'department' | 'jobTitle' | 'missingHireDate' | 'seniority';

function withProfile(
  e: Omit<EmployeeView, ProfileColumn>,
  c: { hireDate: LocalDate | null; department: string | null; jobTitle: string | null } | undefined,
  today: LocalDate,
): EmployeeView {
  const hireDate = c?.hireDate ?? null;
  return {
    ...e,
    hireDate,
    department: c?.department ?? null,
    jobTitle: c?.jobTitle ?? null,
    missingHireDate: hireDate === null,
    seniority: hireDate ? seniorityOf(hireDate, today) : null,
  };
}

function currentView(m: CompanyMemberSnapshot, p: Profile): Omit<EmployeeView, ProfileColumn> {
  const status: EmployeeStatus = !p.hasPassword
    ? 'PENDING_ACTIVATION'
    : m.offboardLastDay === null
      ? 'ACTIVE'
      : 'OFFBOARDING';
  return {
    userId: m.userId,
    fullName: p.fullName,
    email: p.email,
    status,
    grants: [...m.grants],
    startDate: m.startDate,
    offboardLastDay: m.offboardLastDay,
    version: m.version,
  };
}

function leftView(m: DepartedEmployee, p: Profile): Omit<EmployeeView, ProfileColumn> {
  return {
    userId: m.userId,
    fullName: p.fullName,
    email: p.email,
    status: 'LEFT',
    grants: [],
    startDate: null,
    offboardLastDay: m.lastDay,
    version: null,
  };
}
