import type { IClock } from '../../../../core/domain';
import { addDays, toLocal, type LocalDate } from '../../../../core/domain/local-time';
import {
  BusinessRuleViolationError,
  EmailAlreadyExistsError,
  ResourceConflictError,
} from '../../../../core/errors';
import type { ILogger } from '../../../../core/logging/logger';
import type { IUnitOfWork } from '../../../../core/persistence/unit-of-work';
import type { CompanyAccess } from '../company-access';
import type { HrAuditWriter } from '../hr-audit-writer';
import type { ICompanyAccounts } from '../ports/accounts.port';
import type { ICompanyMemberRepository, ICompanyTenureReader } from '../ports/company-member.port';

const HOUR_MS = 60 * 60 * 1000;
/** ADR-137: link kích hoạt nhân viên sống 7 ngày. */
export const EMPLOYEE_ACTIVATION_TTL_MS = 7 * 24 * HOUR_MS;
/** `startDate` lùi tối đa 31 ngày (A S3, TL chốt). */
export const HIRE_BACKDATE_MAX_DAYS = 31;

export interface HireEmployeeInput {
  actorId: string;
  email: string;
  fullName: string;
  startDate?: LocalDate | undefined;
}

export interface HireEmployeeResult {
  employee: {
    userId: string;
    status: 'PENDING_ACTIVATION' | 'ACTIVE';
    version: number;
    startDate: LocalDate;
  };
  accountCreated: boolean;
  activation: { token: string; link: string; expiresAt: Date } | null;
}

/** Khoảng phụ thuộc "hôm nay" của giờ nghiệp vụ ⇒ 422 (E — web hiện câu theo `rule`), không phải 400. */
const startDateIssue = (message: string) =>
  new BusinessRuleViolationError('START_DATE_OUT_OF_RANGE', message);

/**
 * `POST /hr/employees` (`hr:manage`, MỘT transaction — thiết kế Mốc 3.5 §5): email mới ⇒ tài khoản chờ kích
 * hoạt + `company_members(EMPLOYEE)` + token 7 ngày; người đã nghỉ ⇒ nhận lại (nhiệm kỳ mới; đã có mật khẩu ⇒
 * không token, phiên cũ không sống lại); đang thuộc công ty ⇒ 409 `already_employee`; tài khoản đã xóa ⇒ 422
 * `EMAIL_UNAVAILABLE`. HR không tạo Admin / cấp grant (body strict ở contracts).
 */
export class HireEmployeeUseCase {
  constructor(
    private readonly d: {
      access: CompanyAccess;
      members: ICompanyMemberRepository;
      tenures: ICompanyTenureReader;
      accounts: ICompanyAccounts;
      audit: HrAuditWriter;
      uow: IUnitOfWork;
      /** Giờ NGHIỆP VỤ (R31) — "hôm nay" của `startDate`. */
      clock: IClock;
      /** Múi giờ lịch công ty (ADR-120) — attendance (A, T-063) nối phiên bản lịch hiện hành. */
      timeZone: () => Promise<string>;
      logger: ILogger;
    },
  ) {}

  /** Đua hai HR cùng email MỚI: unique `users_email_key` ⇒ cùng 409 `already_employee` như đua PK (SEC-40). */
  async #createPending(input: HireEmployeeInput): Promise<{ userId: string }> {
    try {
      return await this.d.accounts.createPending({ email: input.email, fullName: input.fullName });
    } catch (err) {
      if (err instanceof EmailAlreadyExistsError) {
        throw new ResourceConflictError({ reason: 'already_employee', field: 'email' });
      }
      throw err;
    }
  }

  async execute(input: HireEmployeeInput): Promise<HireEmployeeResult> {
    return this.d.uow.run(async () => {
      const actor = await this.d.access.authorizeWrite({ actorId: input.actorId });
      const now = this.d.clock.now();
      const today = toLocal(now, await this.d.timeZone()).date;
      const startDate = input.startDate ?? today;
      if (startDate > today) throw startDateIssue('Ngày bắt đầu không được ở tương lai.');
      if (startDate < addDays(today, -HIRE_BACKDATE_MAX_DAYS)) {
        throw startDateIssue(`Ngày bắt đầu lùi tối đa ${HIRE_BACKDATE_MAX_DAYS} ngày.`);
      }

      const existing = await this.d.accounts.findByEmail(input.email);
      if (existing?.deleted) {
        throw new BusinessRuleViolationError('EMAIL_UNAVAILABLE', 'Email này không dùng được.');
      }
      if (existing && (await this.d.members.find(existing.userId))) {
        throw new ResourceConflictError({ reason: 'already_employee', field: 'email' });
      }
      if (existing) {
        // Nhận lại: nhiệm kỳ mới phải bắt đầu SAU ngày làm cuối của mọi nhiệm kỳ cũ (tenure không chồng).
        const overlap = await this.d.tenures.tenuresOf({
          userIds: [existing.userId],
          from: startDate,
          to: '9999-12-31',
        });
        if (overlap.length > 0) {
          throw startDateIssue('Ngày bắt đầu phải sau ngày làm cuối của lần làm trước.');
        }
      }
      const { userId } = existing ?? (await this.#createPending(input));
      // Đua hai HR cùng email: PK `company_members` ⇒ 409 `already_employee` (repo ánh xạ).
      const member = await this.d.members.insert({
        userId,
        role: 'EMPLOYEE',
        grants: [],
        startDate,
        at: now,
      });
      const hasPassword = existing?.hasPassword ?? false;
      const activation = hasPassword
        ? null
        : await this.d.accounts.issueActivation({
            userId,
            createdById: actor.userId,
            ttlMs: EMPLOYEE_ACTIVATION_TTL_MS,
          });
      await this.d.audit.record({
        actorId: actor.userId,
        action: existing ? 'EMPLOYEE_REHIRED' : 'EMPLOYEE_HIRED',
        targetUserId: userId,
        after: { role: 'EMPLOYEE', startDate },
      });
      if (activation) {
        await this.d.audit.record({
          actorId: actor.userId,
          action: 'ACTIVATION_LINK_ISSUED',
          targetUserId: userId,
          after: { expiresAt: activation.expiresAt.toISOString() },
        });
      }
      this.d.uow.afterCommit(() => {
        this.d.logger.info(
          { actorId: actor.userId, userId, rehire: existing !== null },
          'company.employee_hired',
        );
      });
      return {
        employee: {
          userId,
          status: hasPassword ? 'ACTIVE' : 'PENDING_ACTIVATION',
          version: member.version,
          startDate,
        },
        accountCreated: existing === null,
        activation,
      };
    });
  }
}
