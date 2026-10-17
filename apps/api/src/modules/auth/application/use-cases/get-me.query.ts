import { SessionRevokedError, UnauthorizedError } from '../../../../core/errors';
import { toUserView, type UserView } from '../auth-shared';
import type {
  ICompanySessionGate,
  IMembershipReader,
  MeCompanyView,
  MembershipView,
} from '../ports/collaborators.port';
import type { IUserRepository } from '../ports/user-repository.port';

export interface GetMeResult {
  user: UserView;
  memberships: MembershipView[];
  company: MeCompanyView;
}

/** `GET /auth/me` — chỉ đọc theo `req.user.id`, không nhận id từ client (security.md 1.8). */
export class GetMeQuery {
  constructor(
    private readonly d: {
      users: IUserRepository;
      memberships: IMembershipReader;
      company: ICompanySessionGate;
    },
  ) {}

  async execute(input: { userId: string }): Promise<GetMeResult> {
    const user = await this.d.users.findById(input.userId);
    if (!user || user.isDeleted) throw new UnauthorizedError();
    // Access token cũ còn hạn của người đã nghỉ ⇒ 401 SESSION_REVOKED (web về /login, không refresh lặp).
    const company = await this.d.company.meOf(user.id);
    if (!company) throw new SessionRevokedError();
    return {
      user: toUserView(user),
      memberships: await this.d.memberships.listForUser(user.id),
      company,
    };
  }
}
