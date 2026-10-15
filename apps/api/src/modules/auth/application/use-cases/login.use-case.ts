import type { IClock } from '../../../../core/domain';
import { InvalidCredentialsError, ValidationError } from '../../../../core/errors';
import type { IUnitOfWork } from '../../../../core/persistence/unit-of-work';
import { Email } from '../../domain/email';
import type { SessionMeta } from '../../domain/refresh-token';
import { toUserView, type UserView } from '../auth-shared';
import type { IPasswordHasher } from '../ports/password-hasher.port';
import type { IUserRepository } from '../ports/user-repository.port';
import type { IssuedSession, SessionIssuer } from '../session-issuer';

export interface LoginInput {
  email: string;
  password: string;
  meta: SessionMeta;
}

export interface LoginResult {
  session: IssuedSession;
  user: UserView;
}

export interface LoginDeps {
  users: IUserRepository;
  issuer: SessionIssuer;
  hasher: IPasswordHasher;
  uow: IUnitOfWork;
  clock: IClock;
}

/** security.md 1.2. Rate limit chạy ở middleware TRƯỚC use case. */
export class LoginUseCase {
  constructor(private readonly d: LoginDeps) {}

  async execute(input: LoginInput): Promise<LoginResult> {
    const user = await this.#findUser(input.email);
    if (!user || user.isDeleted) {
      // Vẫn verify với hash giả ⇒ thời gian giống trường hợp sai mật khẩu (LOG-04).
      await this.d.hasher.verify(null, input.password);
      throw new InvalidCredentialsError();
    }
    if (!(await this.d.hasher.verify(user.passwordHash, input.password))) {
      throw new InvalidCredentialsError();
    }
    // Băm lại (nếu cần) NGOÀI transaction.
    const rehashed = this.d.hasher.needsRehash(user.passwordHash)
      ? await this.d.hasher.hash(input.password)
      : null;

    return this.d.uow.run(async () => {
      const now = this.d.clock.now();
      if (rehashed !== null) user.replacePasswordHash(rehashed, now);
      user.recordLogin(now);
      await this.d.users.save(user);
      const session = await this.d.issuer.startNew(user, input.meta);
      return { session, user: toUserView(user) };
    });
  }

  /** Email sai định dạng ⇒ xử lý như không tồn tại (cùng lỗi, cùng thời gian). */
  async #findUser(rawEmail: string) {
    let email: Email;
    try {
      email = Email.create(rawEmail);
    } catch (err) {
      if (err instanceof ValidationError) return null;
      throw err;
    }
    return this.d.users.findByEmail(email);
  }
}
