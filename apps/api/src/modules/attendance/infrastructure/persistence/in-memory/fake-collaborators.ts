import type { ApprovedLeavePort } from '../../../application/ports/approved-leave.port';
import type {
  IMembershipTenurePort,
  MembershipTenure,
} from '../../../application/ports/membership-tenure.port';
import type { LeavePart } from '../../../domain/summarize-day';

// Fake của các cổng sang module khác (leave — T-039, workspace — T-037b) tới khi có adapter thật.

/** Fake `IMembershipTenurePort` tới khi T-037b (B) có adapter thật — cùng ngữ nghĩa giao `[from, to)`. */
export class FakeMembershipTenures implements IMembershipTenurePort {
  readonly rows: (MembershipTenure & { workspaceId: string })[] = [];

  tenuresOf(q: { workspaceId: string; userIds?: readonly string[]; from: Date; to: Date }) {
    return Promise.resolve(
      this.rows
        .filter(
          (t) =>
            t.workspaceId === q.workspaceId &&
            (!q.userIds || q.userIds.includes(t.userId)) &&
            t.from < q.to &&
            (t.until === null || t.until >= q.from),
        )
        .sort((a, b) =>
          a.userId === b.userId
            ? a.from.getTime() - b.from.getTime()
            : a.userId < b.userId
              ? -1
              : 1,
        )
        .map(({ userId, from, until }) => ({ userId, from, until })),
    );
  }
}

/** Fake `ApprovedLeavePort` tới khi T-039 (leave) có adapter thật. */
export class FakeApprovedLeaves implements ApprovedLeavePort {
  readonly rows: { workspaceId: string; userId: string; date: string; part: LeavePart }[] = [];

  approvedLeaves(q: {
    workspaceId: string;
    userIds?: readonly string[];
    from: string;
    to: string;
  }) {
    return Promise.resolve(
      this.rows
        .filter(
          (l) =>
            l.workspaceId === q.workspaceId &&
            (!q.userIds || q.userIds.includes(l.userId)) &&
            l.date >= q.from &&
            l.date <= q.to,
        )
        .map(({ userId, date, part }) => ({ userId, date, part })),
    );
  }
}
