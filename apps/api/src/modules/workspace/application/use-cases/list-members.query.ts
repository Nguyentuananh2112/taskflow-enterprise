import { ValidationError } from '../../../../core/errors';
import type { IWorkspaceQueries, Page } from '../ports/queries.port';
import { requirePermission, toMemberView, type Actor, type MemberView } from '../workspace-shared';

const Q_MAX = 100;
export const DEFAULT_PAGE_LIMIT = 50;
const PAGE_MAX = 100;

export function pageLimit(limit: number | undefined): number {
  const value = limit ?? DEFAULT_PAGE_LIMIT;
  if (!Number.isInteger(value) || value < 1 || value > PAGE_MAX) {
    throw new ValidationError([
      { path: ['limit'], code: 'too_big', message: `limit trong khoảng 1–${PAGE_MAX}.` },
    ]);
  }
  return value;
}

/** `GET /workspaces/:wsId/members?q=` (ADR-083). Tìm kiếm luôn giới hạn trong ws của actor. */
export class ListMembersQuery {
  constructor(private readonly d: { queries: IWorkspaceQueries }) {}

  async execute(
    actor: Actor,
    input: { q?: string; after?: string | undefined; limit?: number },
  ): Promise<Page<MemberView>> {
    requirePermission(actor, 'member:read');
    const q = input.q?.trim() ?? '';
    if ([...q].length > Q_MAX) {
      throw new ValidationError([
        { path: ['q'], code: 'too_big', message: `Tối đa ${Q_MAX} ký tự.` },
      ]);
    }
    const page = await this.d.queries.listMembers(actor.workspaceId, q === '' ? null : q, {
      after: input.after,
      limit: pageLimit(input.limit),
    });
    return { items: page.items.map((row) => toMemberView(row, row)), nextAfter: page.nextAfter };
  }
}
