import type { IClock, IIdGenerator } from '../../../../core/domain';
import { toLocal } from '../../../../core/domain/local-time';
import type { IUnitOfWork } from '../../../../core/persistence/unit-of-work';
import type { HrAuditWriter } from '../hr-audit-writer';
import type { ICompanyAccounts } from '../ports/accounts.port';
import type { ICompanyMemberRepository, ICompanyRepository } from '../ports/company-member.port';

const HOUR_MS = 60 * 60 * 1000;
/** ADR-137: link của `admin:bootstrap` sống 24 giờ. */
export const BOOTSTRAP_ACTIVATION_TTL_MS = 24 * HOUR_MS;

export interface BootstrapAdminInput {
  email: string;
  fullName: string;
  companyName: string;
  /** `--reissue-link`: chỉ khi MỌI Admin còn chờ kích hoạt. */
  reissueLink: boolean;
}

/**
 * Kết quả — CLI đổi sang exit code: `created` / `promoted` / `reissued` ⇒ 0; còn lại ⇒ 1, không đổi gì.
 */
export type BootstrapAdminResult =
  | {
      outcome: 'created' | 'reissued';
      userId: string;
      activation: { token: string; link: string; expiresAt: Date };
    }
  | { outcome: 'promoted'; userId: string; activation: null }
  | {
      outcome: 'admin_exists' | 'email_unavailable' | 'nothing_to_reissue' | 'admin_activated';
    };

/**
 * Admin đầu tiên (ADR-137, SEC-HR-64). MỘT transaction dưới khóa `taskflow:company:admins` (bậc 2 ADR-136):
 * - đã có Admin ⇒ `admin_exists` (không tạo Admin thứ hai, không đổi mật khẩu ai);
 * - email mới ⇒ `companies` (nếu chưa có) + user chờ kích hoạt + `company_members(ADMIN)` + token 24 giờ;
 * - email là nhân viên ⇒ nâng ADMIN: khóa leave / punch của người đó (bậc 3) TRƯỚC khi đụng dòng, đóng nhiệm kỳ
 *   `ROLE_CHANGED` tới hôm nay, thu hồi phiên (ADR-105 — phiên cũ mang quyền cũ). Đã có mật khẩu ⇒ không token;
 * - `reissueLink`: chỉ khi mọi Admin chưa kích hoạt ⇒ link mới, link cũ chết ngay.
 * Audit actor `null` (CLI).
 */
export class BootstrapAdminUseCase {
  constructor(
    private readonly d: {
      company: ICompanyRepository;
      members: ICompanyMemberRepository;
      accounts: ICompanyAccounts;
      audit: HrAuditWriter;
      uow: IUnitOfWork;
      ids: IIdGenerator;
      /** Giờ NGHIỆP VỤ (TEST_CLOCK_ANCHOR) — ngày đóng nhiệm kỳ. */
      clock: IClock;
      timeZone: () => Promise<string>;
    },
  ) {}

  execute(input: BootstrapAdminInput): Promise<BootstrapAdminResult> {
    return this.d.uow.run(async () => {
      await this.d.members.lockAdmins();
      return input.reissueLink ? this.#reissue() : this.#bootstrap(input);
    });
  }

  async #reissue(): Promise<BootstrapAdminResult> {
    const admins = await this.d.members.listAdmins();
    const first = admins[0];
    if (!first) return { outcome: 'nothing_to_reissue' };
    for (const admin of admins) {
      // Bất kỳ Admin nào đã kích hoạt ⇒ người đó tự quản trị được; CLI không cấp lại (SEC-HR-64).
      const account = await this.d.accounts.findById(admin.userId);
      if (account?.hasPassword !== false) return { outcome: 'admin_activated' };
    }
    const activation = await this.#issue(first.userId);
    return { outcome: 'reissued', userId: first.userId, activation };
  }

  async #bootstrap(input: BootstrapAdminInput): Promise<BootstrapAdminResult> {
    if (await this.d.members.hasAdmin()) return { outcome: 'admin_exists' };
    const now = this.d.clock.now();
    await this.d.company.ensure(input.companyName, now);
    const existing = await this.d.accounts.findByEmail(input.email);
    if (existing?.deleted) return { outcome: 'email_unavailable' };

    const member = existing ? await this.d.members.find(existing.userId) : null;
    if (existing && member?.role === 'EMPLOYEE') {
      const { userId } = existing;
      await this.d.members.lockEmployeeWork(userId); // HIGH-1: TRƯỚC khi UPDATE dòng
      const locked = await this.d.members.findForShare(userId);
      if (!locked || locked.role !== 'EMPLOYEE' || locked.startDate === null) {
        return { outcome: 'admin_exists' }; // không thể xảy ra dưới khóa admins; an toàn: không đổi gì
      }
      const today = toLocal(now, await this.d.timeZone()).date;
      const lastDay = today < locked.startDate ? locked.startDate : today;
      await this.d.members.recordDeparture({
        id: this.d.ids.next(),
        userId,
        role: 'EMPLOYEE',
        firstDay: locked.startDate,
        lastDay,
        leftAt: now,
        reason: 'ROLE_CHANGED',
      });
      await this.d.members.promoteToAdmin(userId, now);
      await this.d.accounts.revokeSessions(userId, 'LOGOUT_ALL');
      await this.d.audit.record({
        actorId: null,
        action: 'COMPANY_ROLE_SET',
        targetUserId: userId,
        before: { role: 'EMPLOYEE', grants: locked.grants },
        after: { role: 'ADMIN' },
      });
      const activation = existing.hasPassword ? null : await this.#issue(userId);
      return activation
        ? { outcome: 'created', userId, activation }
        : { outcome: 'promoted', userId, activation: null };
    }

    const { userId } =
      existing ??
      (await this.d.accounts.createPending({ email: input.email, fullName: input.fullName }));
    await this.d.members.insert({ userId, role: 'ADMIN', grants: [], startDate: null, at: now });
    await this.d.audit.record({
      actorId: null,
      action: 'COMPANY_ROLE_SET',
      targetUserId: userId,
      before: null,
      after: { role: 'ADMIN' },
    });
    if (existing?.hasPassword) return { outcome: 'promoted', userId, activation: null };
    return { outcome: 'created', userId, activation: await this.#issue(userId) };
  }

  async #issue(userId: string) {
    const activation = await this.d.accounts.issueActivation({
      userId,
      createdById: null,
      ttlMs: BOOTSTRAP_ACTIVATION_TTL_MS,
    });
    await this.d.audit.record({
      actorId: null,
      action: 'ACTIVATION_LINK_ISSUED',
      targetUserId: userId,
      after: { expiresAt: activation.expiresAt.toISOString() },
    });
    return activation;
  }
}
