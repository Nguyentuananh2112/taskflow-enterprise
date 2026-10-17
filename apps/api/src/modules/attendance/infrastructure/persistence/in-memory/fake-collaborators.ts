import type { ApprovedLeavePort } from '../../../application/ports/approved-leave.port';
import type {
  CompanyTenure,
  ICompanyTenurePort,
} from '../../../application/ports/collaborators.port';
import type { LeavePart } from '../../../domain/summarize-day';

// Fake của các cổng sang module khác (leave, company) cho test tầng A — cùng ngữ nghĩa với adapter thật.

/** Fake `ICompanyTenurePort`: nhiệm kỳ EMPLOYEE theo NGÀY giao `[from, to]` (gồm hai đầu), sắp theo user rồi `from`. */
export class FakeCompanyTenures implements ICompanyTenurePort {
  readonly rows: CompanyTenure[] = [];

  tenuresOf(q: { userIds?: readonly string[] | undefined; from: string; to: string }) {
    return Promise.resolve(
      this.rows
        .filter(
          (t) =>
            (!q.userIds || q.userIds.includes(t.userId)) &&
            t.from <= q.to &&
            (t.until === null || t.until >= q.from),
        )
        .sort((a, b) =>
          a.userId === b.userId ? (a.from < b.from ? -1 : 1) : a.userId < b.userId ? -1 : 1,
        )
        .map(({ userId, from, until }) => ({ userId, from, until })),
    );
  }
}

/** Fake `ApprovedLeavePort` (adapter thật ở module leave). */
export class FakeApprovedLeaves implements ApprovedLeavePort {
  readonly rows: { userId: string; date: string; part: LeavePart }[] = [];

  approvedLeaves(q: { userIds?: readonly string[]; from: string; to: string }) {
    return Promise.resolve(
      this.rows
        .filter(
          (l) => (!q.userIds || q.userIds.includes(l.userId)) && l.date >= q.from && l.date <= q.to,
        )
        .map(({ userId, date, part }) => ({ userId, date, part })),
    );
  }
}
