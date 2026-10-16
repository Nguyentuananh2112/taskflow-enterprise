import {
  byUserThenFrom,
  overlaps,
  type IMemberDepartureLog,
  type IMembershipTenureReader,
  type MemberDeparture,
  type MembershipTenure,
  type TenureQuery,
} from '../../../application/ports/tenure.port';
import { Table, type InMemoryMembershipRepository } from './in-memory-repositories';

export class InMemoryMemberDepartures
  extends Table<MemberDeparture>
  implements IMemberDepartureLog
{
  record(departure: MemberDeparture): Promise<void> {
    this.byId.set(departure.id, { ...departure });
    return Promise.resolve();
  }
}

/** Cùng ngữ nghĩa với `PrismaMembershipTenureReader` (LSP: test chạy lại trên Postgres). */
export class InMemoryMembershipTenureReader implements IMembershipTenureReader {
  constructor(
    private readonly memberships: InMemoryMembershipRepository,
    private readonly departures: InMemoryMemberDepartures,
  ) {}

  tenuresOf(q: TenureQuery): Promise<MembershipTenure[]> {
    const wanted = (userId: string) => q.userIds === undefined || q.userIds.includes(userId);
    const current = this.memberships
      .rows()
      .filter((m) => m.workspaceId === q.workspaceId && m.role !== 'VIEWER' && wanted(m.userId))
      .map((m) => ({ userId: m.userId, from: m.joinedAt, until: null }));
    const past = this.departures
      .rows()
      .filter((d) => d.workspaceId === q.workspaceId && d.role !== 'VIEWER' && wanted(d.userId))
      .map((d) => ({ userId: d.userId, from: d.joinedAt, until: d.leftAt }));
    return Promise.resolve(
      [...current, ...past].filter((t) => overlaps(t, q)).sort(byUserThenFrom),
    );
  }
}
