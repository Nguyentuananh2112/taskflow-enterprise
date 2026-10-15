import type { IClock, IIdGenerator } from '../../../../core/domain';
import { InternalError, ResourceConflictError } from '../../../../core/errors';
import type { IEventBus } from '../../../../core/events/event-bus';
import type { IUnitOfWork } from '../../../../core/persistence/unit-of-work';
import { Email } from '../../domain/email';
import type { PasswordPolicy } from '../../domain/password-policy';
import type { SessionMeta } from '../../domain/refresh-token';
import { User } from '../../domain/user';
import { assertPasswordAllowed, toUserView, type UserView } from '../auth-shared';
import type { IWorkspaceProvisioner } from '../ports/collaborators.port';
import type { IPasswordHasher } from '../ports/password-hasher.port';
import type { IUserRepository } from '../ports/user-repository.port';
import type { IssuedSession, SessionIssuer } from '../session-issuer';

/** R19: trùng slug ⇒ thử lại cả transaction, tối đa 5 lần. */
export const MAX_REGISTER_ATTEMPTS = 5;

export interface RegisterInput {
  email: string;
  password: string;
  fullName: string;
  meta: SessionMeta;
}

export interface RegisterResult {
  session: IssuedSession;
  user: UserView;
  defaultWorkspaceId: string;
}

export interface RegisterDeps {
  users: IUserRepository;
  provisioner: IWorkspaceProvisioner;
  issuer: SessionIssuer;
  hasher: IPasswordHasher;
  policy: PasswordPolicy;
  uow: IUnitOfWork;
  events: IEventBus;
  ids: IIdGenerator;
  clock: IClock;
}

function isSlugConflict(err: unknown): boolean {
  return err instanceof ResourceConflictError && err.details?.['field'] === 'slug';
}

/** FR-01 / security.md 1.1: user + workspace mặc định + OWNER + project + phiên — một transaction. */
export class RegisterUseCase {
  constructor(private readonly d: RegisterDeps) {}

  async execute(input: RegisterInput): Promise<RegisterResult> {
    // Kiểm mọi thứ rẻ TRƯỚC khi băm; băm NGOÀI transaction (REG-10).
    const email = Email.create(input.email);
    const fullName = User.validateFullName(input.fullName);
    assertPasswordAllowed(this.d.policy, input.password, email, 'password');
    const passwordHash = await this.d.hasher.hash(input.password);

    for (let attempt = 0; attempt < MAX_REGISTER_ATTEMPTS; attempt += 1) {
      try {
        return await this.d.uow.run(() =>
          this.#createAccount({ email, fullName, passwordHash, meta: input.meta, attempt }),
        );
      } catch (err) {
        if (!isSlugConflict(err)) throw err;
      }
    }
    throw new InternalError(new Error(`Hết ${MAX_REGISTER_ATTEMPTS} lần thử slug khi đăng ký`));
  }

  async #createAccount(a: {
    email: Email;
    fullName: string;
    passwordHash: string;
    meta: SessionMeta;
    attempt: number;
  }): Promise<RegisterResult> {
    const user = User.register({
      id: this.d.ids.next(),
      email: a.email,
      passwordHash: a.passwordHash,
      fullName: a.fullName,
      now: this.d.clock.now(),
    });
    await this.d.users.add(user); // email trùng ⇒ EmailAlreadyExistsError từ unique constraint
    const { workspaceId } = await this.d.provisioner.provisionDefault({
      ownerId: user.id,
      ownerFullName: a.fullName,
      attempt: a.attempt,
    });
    const session = await this.d.issuer.startNew(user, a.meta);
    const events = user.pullDomainEvents();
    this.d.uow.afterCommit(() => this.d.events.publish(events));
    return { session, user: toUserView(user), defaultWorkspaceId: workspaceId };
  }
}
