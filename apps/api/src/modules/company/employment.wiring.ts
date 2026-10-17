import type { IClock, IIdGenerator } from '../../core/domain';
import type { ILogger } from '../../core/logging/logger';
import type { IUnitOfWork } from '../../core/persistence/unit-of-work';
import type { CompanyAccess } from './application/company-access';
import type { HrAuditWriter } from './application/hr-audit-writer';
import type { ICompanyAccounts } from './application/ports/accounts.port';
import type { ICompanyMemberRepository } from './application/ports/company-member.port';
import type { EmploymentCollaborators } from './application/ports/employment-collaborators.port';
import type { ICompanyOffboardingRepository } from './application/ports/offboarding.port';
import { EmployeeQueries } from './application/use-cases/employees.queries';
import { CompleteOffboardingUseCase } from './application/use-cases/complete-offboarding.use-case';
import {
  CancelOffboardingUseCase,
  ScheduleOffboardingUseCase,
} from './application/use-cases/offboarding.use-cases';
import { ReissueActivationUseCase } from './application/use-cases/reissue-activation.use-case';
import type { CompanyPermission } from './domain/roles';

/** Vòng đời nhân viên (T-062): danh sách, lịch nghỉ / hủy / hoàn tất (+ job mỗi phút), tạo lại link. */
export function createEmployment(d: {
  access: CompanyAccess;
  members: ICompanyMemberRepository;
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
    employees: new EmployeeQueries(d),
    schedule: new ScheduleOffboardingUseCase(d, completer),
    cancel: new CancelOffboardingUseCase(d),
    completer,
    reissue: new ReissueActivationUseCase(d),
  };
}

export type Employment = ReturnType<typeof createEmployment>;

/** Tham chiếu trễ (composition gán `current` trước khi app nhận request / job chạy). */
export function lateCollaborators(ref: {
  current: EmploymentCollaborators | null;
}): () => EmploymentCollaborators {
  return () => {
    if (!ref.current)
      throw new Error('company: chưa nối cộng tác vòng đời nhân viên (composition)');
    return ref.current;
  };
}
