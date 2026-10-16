import {
  byUserThenFrom,
  type IMemberDepartureLog,
  type IMembershipTenureReader,
  type MemberDeparture,
  type MembershipTenure,
  type TenureQuery,
} from '../../../application/ports/tenure.port';
import type { DbProvider } from './db';

export class PrismaMemberDepartures implements IMemberDepartureLog {
  constructor(private readonly db: DbProvider) {}

  async record(departure: MemberDeparture): Promise<void> {
    await this.db().workspaceMemberDeparture.create({ data: { ...departure } });
  }
}

/**
 * Nhiệm kỳ = dòng workspace_members hiện tại (joined_at, null) ∪ workspace_member_departures; lọc giao
 * `[from, to)` và loại VIEWER ngay trong WHERE (index (workspace_id, left_at) / (workspace_id, user_id)).
 */
export class PrismaMembershipTenureReader implements IMembershipTenureReader {
  constructor(private readonly db: DbProvider) {}

  async tenuresOf(q: TenureQuery): Promise<MembershipTenure[]> {
    if (q.userIds?.length === 0) return [];
    const users = q.userIds === undefined ? {} : { userId: { in: [...q.userIds] } };
    // Tuần tự (không Promise.all): trong transaction tương tác client chỉ chạy một truy vấn một lúc.
    const current = await this.db().workspaceMember.findMany({
      where: {
        workspaceId: q.workspaceId,
        role: { not: 'VIEWER' },
        joinedAt: { lt: q.to },
        ...users,
      },
      select: { userId: true, joinedAt: true },
    });
    const past = await this.db().workspaceMemberDeparture.findMany({
      where: {
        workspaceId: q.workspaceId,
        role: { not: 'VIEWER' },
        joinedAt: { lt: q.to },
        leftAt: { gte: q.from },
        ...users,
      },
      select: { userId: true, joinedAt: true, leftAt: true },
    });
    return [
      ...current.map((m) => ({ userId: m.userId, from: m.joinedAt, until: null })),
      ...past.map((d) => ({ userId: d.userId, from: d.joinedAt, until: d.leftAt })),
    ].sort(byUserThenFrom);
  }
}
