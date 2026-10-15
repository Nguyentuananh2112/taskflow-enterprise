import { UnauthorizedError } from '../../../../core/errors';
import { toUserView, type UserView } from '../auth-shared';
import type { IMembershipReader, MembershipView } from '../ports/collaborators.port';
import type { IUserRepository } from '../ports/user-repository.port';

export interface GetMeResult {
  user: UserView;
  memberships: MembershipView[];
}

/** `GET /auth/me` — chỉ đọc theo `req.user.id`, không nhận id từ client (security.md 1.8). */
export class GetMeQuery {
  constructor(private readonly d: { users: IUserRepository; memberships: IMembershipReader }) {}

  async execute(input: { userId: string }): Promise<GetMeResult> {
    const user = await this.d.users.findById(input.userId);
    if (!user || user.isDeleted) throw new UnauthorizedError();
    return { user: toUserView(user), memberships: await this.d.memberships.listForUser(user.id) };
  }
}
