import type {
  IPayrollStore,
  PayrollRunRecord,
  PayrollSettingsRecord,
  PayslipRecord,
  SalaryProfileRecord,
} from '../../application/ports/payroll-store.port';

interface State {
  settings: PayrollSettingsRecord;
  profiles: SalaryProfileRecord[];
  runs: PayrollRunRecord[];
  payslips: PayslipRecord[];
}

const copy = <T>(v: T): T => structuredClone(v);

/**
 * Bản in-memory cùng hợp đồng với Prisma (LSP): mô phỏng các ràng buộc của migration 7 — unique (userId, effectiveFrom),
 * unique (period), một bản hiệu lực / (run, user), bảng PUBLISHED bất biến (trigger: không UPDATE phiếu / bảng, chỉ đặt
 * `superseded_at`), phát hành đặt đủ 4 cột.
 */
export class InMemoryPayrollStore implements IPayrollStore {
  #s: State = {
    settings: { seniorityPerYear: 500_000, version: 1, updatedAt: new Date(0), updatedById: null },
    profiles: [],
    runs: [],
    payslips: [],
  };
  /** Thứ tự khóa đã lấy (test). */
  readonly locks: string[] = [];

  snapshot(): unknown {
    return copy(this.#s);
  }

  restore(snapshot: unknown): void {
    this.#s = copy(snapshot as State);
  }

  lockPeriod(period: string): Promise<void> {
    this.locks.push(`taskflow:payroll:${period}`);
    return Promise.resolve();
  }

  getSettings() {
    return Promise.resolve(copy(this.#s.settings));
  }

  updateSettings(input: Parameters<IPayrollStore['updateSettings']>[0]) {
    const s = this.#s.settings;
    if (s.version !== input.expectedVersion) return Promise.resolve(null);
    this.#s.settings = {
      seniorityPerYear: input.seniorityPerYear,
      version: s.version + 1,
      updatedAt: input.at,
      updatedById: input.updatedById,
    };
    return Promise.resolve(copy(this.#s.settings));
  }

  listProfiles(userIds?: readonly string[]) {
    return Promise.resolve(
      this.#s.profiles
        .filter((p) => !userIds || userIds.includes(p.userId))
        .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))
        .map(copy),
    );
  }

  insertProfile(record: SalaryProfileRecord) {
    if (
      this.#s.profiles.some(
        (p) => p.userId === record.userId && p.effectiveFrom === record.effectiveFrom,
      )
    ) {
      return Promise.resolve('duplicate' as const);
    }
    this.#s.profiles.push(copy(record));
    return Promise.resolve('ok' as const);
  }

  listRuns() {
    return Promise.resolve(
      [...this.#s.runs]
        .sort((a, b) => (a.period < b.period ? 1 : -1))
        .map((r) => {
          const current = this.#current(r.id);
          return {
            ...copy(r),
            payslipCount: current.length,
            netTotal: current.reduce((sum, p) => sum + p.netPay, 0),
          };
        }),
    );
  }

  findRun(period: string) {
    const r = this.#s.runs.find((x) => x.period === period);
    return Promise.resolve(r ? copy(r) : null);
  }

  insertRun(record: PayrollRunRecord) {
    if (this.#s.runs.some((r) => r.period === record.period))
      return Promise.resolve('exists' as const);
    this.#s.runs.push(copy(record));
    return Promise.resolve('ok' as const);
  }

  updateDraftRun(runId: string, input: { standardDays: number; seniorityPerYear: number }) {
    const r = this.#s.runs.find((x) => x.id === runId && x.status === 'DRAFT');
    if (!r) return Promise.resolve(false);
    Object.assign(r, input);
    return Promise.resolve(true);
  }

  publishRun(input: Parameters<IPayrollStore['publishRun']>[0]) {
    const r = this.#s.runs.find((x) => x.id === input.runId && x.status === 'DRAFT');
    if (!r) return Promise.resolve(false);
    Object.assign(r, {
      status: 'PUBLISHED',
      publishedAt: input.publishedAt,
      publishedById: input.publishedById,
      companyName: input.companyName,
    });
    return Promise.resolve(true);
  }

  listCurrentPayslips(runId: string) {
    return Promise.resolve(
      this.#current(runId)
        .sort((a, b) => (a.userId < b.userId ? -1 : 1))
        .map(copy),
    );
  }

  findCurrentPayslip(runId: string, userId: string) {
    const p = this.#current(runId).find((x) => x.userId === userId);
    return Promise.resolve(p ? copy(p) : null);
  }

  listRevisions(runId: string, userId: string) {
    return Promise.resolve(
      this.#s.payslips
        .filter((p) => p.runId === runId && p.userId === userId)
        .sort((a, b) => a.revision - b.revision)
        .map(copy),
    );
  }

  insertPayslip(record: PayslipRecord) {
    const clash = this.#s.payslips.some(
      (p) =>
        p.runId === record.runId &&
        p.userId === record.userId &&
        (p.revision === record.revision ||
          (p.supersededAt === null && record.supersededAt === null)),
    );
    if (clash)
      return Promise.reject(new Error('unique payslips_current_key / (run, user, revision)'));
    this.#s.payslips.push(copy(record));
    return Promise.resolve();
  }

  updateDraftPayslip(record: PayslipRecord, expectedLockVersion: number) {
    const run = this.#s.runs.find((r) => r.id === record.runId);
    if (run?.status !== 'DRAFT')
      return Promise.reject(new Error('trigger: bảng đã phát hành bất biến'));
    const p = this.#s.payslips.find(
      (x) => x.id === record.id && x.supersededAt === null && x.lockVersion === expectedLockVersion,
    );
    if (!p) return Promise.resolve(null);
    Object.assign(p, copy(record), { lockVersion: p.lockVersion + 1 });
    return Promise.resolve(copy(p));
  }

  supersede(payslipId: string, at: Date) {
    const p = this.#s.payslips.find((x) => x.id === payslipId && x.supersededAt === null);
    if (!p) return Promise.resolve(false);
    p.supersededAt = at;
    return Promise.resolve(true);
  }

  myPayslips(userId: string) {
    const out = this.#s.runs
      .filter((r) => r.status === 'PUBLISHED')
      .flatMap((r) =>
        this.#current(r.id)
          .filter((p) => p.userId === userId)
          .map((p) => ({ period: r.period, revision: p.revision, publishedAt: r.publishedAt! })),
      )
      .sort((a, b) => (a.period < b.period ? 1 : -1));
    return Promise.resolve(out);
  }

  payslipPeriods(ids: readonly string[]) {
    const byRun = new Map(this.#s.runs.map((r) => [r.id, r.period]));
    return Promise.resolve(
      new Map(
        this.#s.payslips
          .filter((p) => ids.includes(p.id))
          .map((p) => [p.id, byRun.get(p.runId)!] as const),
      ),
    );
  }

  #current(runId: string) {
    return this.#s.payslips.filter((p) => p.runId === runId && p.supersededAt === null);
  }
}
