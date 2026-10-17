import type {
  IEmployeeProfileRepository,
  IProfileLocks,
} from '../../application/ports/employee-profile.port';
import type { EmployeeProfileSnapshot, ProfileFields } from '../../domain/employee-profile';

const collator = new Intl.Collator('vi', { sensitivity: 'base' });
const distinctSorted = (values: (string | null)[]) =>
  [...new Set(values.filter((v): v is string => v !== null))].sort(collator.compare);

/**
 * `employee_profiles` trong bộ nhớ (dev / unit test) — cùng ngữ nghĩa với `PrismaEmployeeProfiles`; snapshot /
 * restore cho UoW bộ nhớ. Khóa là no-op (UoW bộ nhớ đã tuần tự hóa transaction).
 */
export class InMemoryEmployeeProfiles implements IEmployeeProfileRepository, IProfileLocks {
  #rows = new Map<string, EmployeeProfileSnapshot>();

  find(userId: string): Promise<EmployeeProfileSnapshot | null> {
    const row = this.#rows.get(userId);
    return Promise.resolve(row ? { ...row } : null);
  }

  findForUpdate(userId: string): Promise<EmployeeProfileSnapshot | null> {
    return this.find(userId);
  }

  findMany(userIds: readonly string[]): Promise<ReadonlyMap<string, EmployeeProfileSnapshot>> {
    const out = new Map<string, EmployeeProfileSnapshot>();
    for (const id of userIds) {
      const row = this.#rows.get(id);
      if (row) out.set(id, { ...row });
    }
    return Promise.resolve(out);
  }

  save(input: {
    userId: string;
    fields: ProfileFields;
    expectedVersion: number;
    updatedById: string;
    at: Date;
  }): Promise<EmployeeProfileSnapshot | null> {
    const current = this.#rows.get(input.userId);
    const currentVersion = current?.version ?? 0;
    if (currentVersion !== input.expectedVersion) return Promise.resolve(null);
    const row: EmployeeProfileSnapshot = {
      userId: input.userId,
      ...input.fields,
      version: currentVersion + 1,
      updatedById: input.updatedById,
      updatedAt: input.at,
    };
    this.#rows.set(input.userId, row);
    return Promise.resolve({ ...row });
  }

  suggestions(): Promise<{ departments: string[]; jobTitles: string[] }> {
    const rows = [...this.#rows.values()];
    return Promise.resolve({
      departments: distinctSorted(rows.map((r) => r.department)),
      jobTitles: distinctSorted(rows.map((r) => r.jobTitle)),
    });
  }

  lockLeavePolicyShared(): Promise<void> {
    return Promise.resolve();
  }

  lockLeave(): Promise<void> {
    return Promise.resolve();
  }

  snapshot(): unknown {
    return new Map([...this.#rows].map(([k, v]) => [k, { ...v }]));
  }

  restore(snapshot: unknown): void {
    this.#rows = snapshot as Map<string, EmployeeProfileSnapshot>;
  }
}
