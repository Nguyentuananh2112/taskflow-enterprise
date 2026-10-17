import type {
  IMemberCandidateDirectory,
  MemberCandidate,
} from '../../../application/ports/collaborators.port';

/** Dòng công ty mà danh bạ cần — khớp cấu trúc `InMemoryCompanyStore.members()` (workspace không import company). */
export interface CompanyMemberRows {
  members(): readonly { userId: string; offboardLastDay: string | null }[];
}

/** Bản bộ nhớ của `IMemberCandidateDirectory` (dev/test) — so khớp theo nghĩa đen như `listMembers`. */
export class InMemoryMemberCandidates implements IMemberCandidateDirectory {
  constructor(
    private readonly company: CompanyMemberRows,
    private readonly users: { users: ReadonlyMap<string, MemberCandidate> },
    private readonly memberships: { rows(): readonly { workspaceId: string; userId: string }[] },
  ) {}

  search(input: { workspaceId: string; q: string; limit: number }): Promise<MemberCandidate[]> {
    const needle = input.q.toLowerCase();
    const inWs = new Set(
      this.memberships
        .rows()
        .filter((m) => m.workspaceId === input.workspaceId)
        .map((m) => m.userId),
    );
    const rows = this.company
      .members()
      .filter((m) => m.offboardLastDay === null && !inWs.has(m.userId))
      .flatMap((m) => {
        const u = this.users.users.get(m.userId);
        return u ? [{ id: u.id, fullName: u.fullName, email: u.email }] : [];
      })
      .filter(
        (u) => u.email.toLowerCase().includes(needle) || u.fullName.toLowerCase().includes(needle),
      )
      .sort((a, b) =>
        a.fullName < b.fullName ? -1 : a.fullName > b.fullName ? 1 : a.id < b.id ? -1 : 1,
      );
    return Promise.resolve(rows.slice(0, input.limit));
  }
}
