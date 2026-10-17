import type { IClock, IIdGenerator } from '../../core/domain';
import { ResourceNotFoundError } from '../../core/errors';
import type { ILogger } from '../../core/logging/logger';
import type { IUnitOfWork } from '../../core/persistence/unit-of-work';
import type { CompanyAccess } from './application/company-access';
import type { HrAuditWriter } from './application/hr-audit-writer';
import type { ICompanyAccounts } from './application/ports/accounts.port';
import type {
  ICompanyMemberRepository,
  ICompanyRepository,
  ICompanyTenureReader,
} from './application/ports/company-member.port';
import { BootstrapAdminUseCase } from './application/use-cases/bootstrap-admin.use-case';
import { HireEmployeeUseCase } from './application/use-cases/hire-employee.use-case';
import type { EmploymentCollaborators } from './application/ports/employment-collaborators.port';
import type { ICompanyOffboardingRepository } from './application/ports/offboarding.port';
import { EmployeeQueries } from './application/use-cases/employees.queries';
import { CompleteOffboardingUseCase } from './application/use-cases/complete-offboarding.use-case';
import {
  CancelOffboardingUseCase,
  ScheduleOffboardingUseCase,
} from './application/use-cases/offboarding.use-cases';
import { ReissueActivationUseCase } from './application/use-cases/reissue-activation.use-case';
import type { EmployeeStatus } from './domain/company-member';
import type { CompanyPermission } from './domain/roles';

/**
 * Vòng đời nhân viên: thêm / nhận lại, bootstrap Admin (T-061); danh sách, lịch nghỉ / hủy / hoàn tất (+ job mỗi
 * phút), tạo lại link (T-062).
 */
export function createEmployment(d: {
  access: CompanyAccess;
  members: ICompanyMemberRepository;
  company: ICompanyRepository;
  tenures: ICompanyTenureReader;
  offboarding: ICompanyOffboardingRepository;
  accounts: ICompanyAccounts;
  collaborators: () => EmploymentCollaborators;
  audit: HrAuditWriter;
  uow: IUnitOfWork;
  ids: IIdGenerator;
  clock: IClock;
  timeZone: () => Promise<string>;
  logger: ILogger;
  permissionsOf(userId: string): Promise<ReadonlySet<CompanyPermission> | null>;
}) {
  const completer = new CompleteOffboardingUseCase(d);
  return {
    hire: new HireEmployeeUseCase({
      ...d,
      rehireLeave: () => d.collaborators().rehireLeave,
      hireProfile: () => d.collaborators().hireProfile,
    }),
    bootstrap: new BootstrapAdminUseCase(d),
    employees: new EmployeeQueries({
      ...d,
      profileColumns: () => d.collaborators().profileColumns,
    }),
    schedule: new ScheduleOffboardingUseCase(d, completer),
    cancel: new CancelOffboardingUseCase(d),
    completer,
    reissue: new ReissueActivationUseCase(d),
  };
}

export type Employment = ReturnType<typeof createEmployment>;

/**
 * Người TỪNG có nhiệm kỳ EMPLOYEE (hồ sơ — ADR-128): có nhiệm kỳ (đang / đã đóng, kể cả Admin từng là nhân viên) VÀ
 * tài khoản chưa xóa. Chưa từng (Admin chưa từng là nhân viên) ⇒ `null` (404 `user`).
 */
export async function employeeRefOf(
  d: { tenures: ICompanyTenureReader; employees: Pick<EmployeeQueries, 'one'> },
  userId: string,
): Promise<{ fullName: string; status: EmployeeStatus } | null> {
  const ever = await d.tenures.tenuresOf({
    userIds: [userId],
    from: '0001-01-01',
    to: '9999-12-31',
  });
  if (ever.length === 0) return null;
  try {
    const e = await d.employees.one(userId);
    return { fullName: e.fullName, status: e.status };
  } catch (err) {
    if (err instanceof ResourceNotFoundError) return null;
    throw err;
  }
}

/** Tài khoản của auth (auth dựng SAU company — cần cổng công ty) ⇒ proxy đọc `current` lúc chạy request. */
export function lateAccounts(ref: { current: ICompanyAccounts | null }): ICompanyAccounts {
  const of = (): ICompanyAccounts => {
    if (!ref.current) throw new Error('company: chưa nối port tài khoản (composition)');
    return ref.current;
  };
  return {
    findByEmail: (email) => of().findByEmail(email),
    findById: (userId) => of().findById(userId),
    profiles: (userIds) => of().profiles(userIds),
    revokeSessions: (userId, reason) => of().revokeSessions(userId, reason),
    revokeActivations: (userId) => of().revokeActivations(userId),
    createPending: (input) => of().createPending(input),
    issueActivation: (input) => of().issueActivation(input),
  };
}
