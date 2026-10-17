import type { IClock, IIdGenerator } from '../../../../core/domain';
import { ActivationGoneError, ActivationInvalidError } from '../../../../core/errors';
import type { ILogger } from '../../../../core/logging/logger';
import type { IUnitOfWork } from '../../../../core/persistence/unit-of-work';
import type { PasswordPolicy } from '../../domain/password-policy';
import type { SessionMeta } from '../../domain/refresh-token';
import type { User } from '../../domain/user';
import { assertPasswordAllowed, toUserView, type UserView } from '../auth-shared';
import type { IActivationTokenRepository } from '../ports/activation-token-repository.port';
import type { ICompanySessionGate } from '../ports/collaborators.port';
import type { IPasswordHasher } from '../ports/password-hasher.port';
import type { IRefreshTokenFactory } from '../ports/refresh-token-factory.port';
import type { IUserRepository } from '../ports/user-repository.port';
import type { IssuedSession, SessionIssuer } from '../session-issuer';

const HOUR_MS = 60 * 60 * 1000;
/** ADR-137: link nhân viên 7 ngày, link `admin:bootstrap` 24 giờ. */
export const ACTIVATION_TTL_MS = 7 * 24 * HOUR_MS;
export const BOOTSTRAP_ACTIVATION_TTL_MS = 24 * HOUR_MS;

export interface IssuedActivation {
  /** Token thô — chỉ trả MỘT lần trong response (`no-store`), không lưu, không log. */
  token: string;
  /** `<WEB_ORIGIN>/activate#t=<token>` — fragment không tới server / Referer. */
  link: string;
  expiresAt: Date;
}

/** Cấp token kích hoạt TRONG transaction của bên gọi (thêm nhân viên, bootstrap, tạo lại link — T-062). */
export class ActivationIssuer {
  constructor(
    private readonly d: {
      tokens: IActivationTokenRepository;
      /** Cùng sinh 256 bit + SHA-256 như refresh token (security.md 2.2). */
      factory: Pick<IRefreshTokenFactory, 'generate'>;
      ids: IIdGenerator;
      clock: IClock;
      webOrigin: string;
    },
  ) {}

  async issue(input: {
    userId: string;
    createdById: string | null;
    ttlMs: number;
  }): Promise<IssuedActivation> {
    const { token, hash } = this.d.factory.generate();
    const at = this.d.clock.now();
    const expiresAt = new Date(at.getTime() + input.ttlMs);
    await this.d.tokens.issue({
      id: this.d.ids.next(),
      userId: input.userId,
      tokenHash: hash,
      expiresAt,
      createdById: input.createdById,
      at,
    });
    return { token, link: `${this.d.webOrigin}/activate#t=${token}`, expiresAt };
  }

  /** Nghỉ việc / xóa: mọi token sống của user chết NGAY (ADR-137 "Hoàn tất" bước 5). Trả số token bị thu hồi. */
  revokeAll(userId: string): Promise<number> {
    return this.d.tokens.revokeAllForUser(userId, this.d.clock.now());
  }
}

interface ResolveDeps {
  tokens: IActivationTokenRepository;
  factory: Pick<IRefreshTokenFactory, 'hash'>;
  users: IUserRepository;
  company: ICompanySessionGate;
  clock: IClock;
}

/**
 * Token ⇒ user chờ kích hoạt. Không có hash ⇒ 400 `ACTIVATION_INVALID`; đã dùng / thu hồi / hết hạn, user đã
 * có mật khẩu / bị xóa / không còn thuộc công ty ⇒ 410 `ACTIVATION_GONE` (ADR-137 điều 3).
 */
async function resolve(d: ResolveDeps, token: string): Promise<{ id: string; user: User }> {
  const record = await d.tokens.findByHash(d.factory.hash(token));
  if (!record) throw new ActivationInvalidError();
  const now = d.clock.now();
  if (record.usedAt || record.revokedAt || record.expiresAt.getTime() <= now.getTime()) {
    throw new ActivationGoneError();
  }
  const user = await d.users.findById(record.userId);
  if (!user || user.isDeleted || user.passwordHash !== null) throw new ActivationGoneError();
  if (!(await d.company.isActive(user.id))) throw new ActivationGoneError();
  return { id: record.id, user };
}

/** `POST /auth/activation/inspect` — CHỈ ĐỌC (bot xem trước link không tiêu token — điều 4). */
export class InspectActivationQuery {
  constructor(private readonly d: ResolveDeps) {}

  async execute(input: {
    token: string;
  }): Promise<{ fullName: string; email: string; companyName: string | null }> {
    const { user } = await resolve(this.d, input.token);
    return {
      fullName: user.fullName,
      email: user.email.value,
      companyName: await this.d.company.companyName(),
    };
  }
}

/** Lắp ba thành phần kích hoạt trên cùng kho token + đồng hồ (giờ nghiệp vụ — ADR-137). */
export function createActivation(
  d: Omit<ResolveDeps, 'factory'> & {
    factory: Pick<IRefreshTokenFactory, 'generate' | 'hash'>;
    ids: IIdGenerator;
    webOrigin: string;
    hasher: IPasswordHasher;
    policy: PasswordPolicy;
    issuer: SessionIssuer;
    uow: IUnitOfWork;
    logger: ILogger;
  },
) {
  return {
    issuer: new ActivationIssuer(d),
    inspect: new InspectActivationQuery(d),
    activate: new ActivateAccountUseCase(d),
  };
}

/**
 * `POST /auth/activate` — đặt mật khẩu đầu tiên + tiêu token trong MỘT transaction ⇒ phiên mới như đăng
 * nhập. Mật khẩu yếu ⇒ lỗi validate TRƯỚC transaction: token vẫn sống.
 */
export class ActivateAccountUseCase {
  constructor(
    private readonly d: ResolveDeps & {
      hasher: IPasswordHasher;
      policy: PasswordPolicy;
      issuer: SessionIssuer;
      uow: IUnitOfWork;
      logger: ILogger;
    },
  ) {}

  async execute(input: {
    token: string;
    password: string;
    meta: SessionMeta;
  }): Promise<{ session: IssuedSession; user: UserView }> {
    const { user } = await resolve(this.d, input.token);
    assertPasswordAllowed(this.d.policy, input.password, user.email, 'password');
    const hash = await this.d.hasher.hash(input.password); // NGOÀI transaction (PWD-07)

    return this.d.uow.run(async () => {
      const now = this.d.clock.now();
      // Đọc lại trong transaction: hai request cùng token ⇒ `consume` chỉ cho một bên (đếm 1 dòng).
      const { id } = await resolve(this.d, input.token);
      if (!(await this.d.tokens.consume(id, now))) throw new ActivationGoneError();
      const tokenVersion = await this.d.users.setInitialPassword({ id: user.id, hash, at: now });
      if (tokenVersion === null) throw new ActivationGoneError(); // rollback cả `consume`
      const session = await this.d.issuer.startNew({ id: user.id, tokenVersion }, input.meta);
      this.d.uow.afterCommit(() => {
        this.d.logger.info({ userId: user.id, ip: input.meta.ip }, 'auth.account_activated');
      });
      return { session, user: toUserView(user) };
    });
  }
}
