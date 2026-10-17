import type { IMemberCandidateDirectory, MemberCandidate } from '../ports/collaborators.port';
import { requirePermission, type Actor } from '../workspace-shared';

/** Combobox "Thêm thành viên" trả tối đa chừng này người (ADR-134). */
export const MEMBER_CANDIDATES_LIMIT = 20;

/**
 * `GET /workspaces/:wsId/member-candidates?q=` (ADR-134, R41): người thuộc công ty thêm được vào ws của actor, chưa
 * là thành viên. `q` đã qua contract (trim, 2..100 ký tự). Quyền `member:add` (MEMBER/VIEWER ⇒ 403).
 */
export class ListMemberCandidatesQuery {
  constructor(private readonly d: { candidates: IMemberCandidateDirectory }) {}

  async execute(actor: Actor, input: { q: string }): Promise<MemberCandidate[]> {
    requirePermission(actor, 'member:add');
    return await this.d.candidates.search({
      workspaceId: actor.workspaceId,
      q: input.q,
      limit: MEMBER_CANDIDATES_LIMIT,
    });
  }
}
