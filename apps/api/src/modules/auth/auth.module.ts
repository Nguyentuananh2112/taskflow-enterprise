import type { RequestHandler, Router } from 'express';

import type { IClock, IIdGenerator } from '../../core/domain';
import type { IEventBus } from '../../core/events/event-bus';
import type { HttpResponder } from '../../core/http/envelope';
import type { RateLimitRule } from '../../core/http/rate-limit/rules';
import type { ILogger } from '../../core/logging/logger';
import type { IUnitOfWork } from '../../core/persistence/unit-of-work';
import { AccessTokenAuthenticator } from './application/access-token-authenticator';
import { ACCESS_TOKEN_TTL_SECONDS } from './application/auth-shared';
import type { IAccessTokenService } from './application/ports/access-token-service.port';
import type { IActivationTokenRepository } from './application/ports/activation-token-repository.port';
import type {
  IAuthRealtimeNotifier,
  ICompanySessionGate,
  IMembershipReader,
} from './application/ports/collaborators.port';
import type { IPasswordHasher } from './application/ports/password-hasher.port';
import type { IRefreshTokenRepository } from './application/ports/refresh-token-repository.port';
import type { ISessionRevocationStore } from './application/ports/session-revocation-store.port';
import type { IUserRepository } from './application/ports/user-repository.port';
import { createAuthAccounts, type AuthAccounts } from './application/auth-accounts';
import { SessionIssuer } from './application/session-issuer';
import { createActivation } from './application/use-cases/activation.use-cases';
import { ChangePasswordUseCase } from './application/use-cases/change-password.use-case';
import { GetMeQuery } from './application/use-cases/get-me.query';
import { LoginUseCase } from './application/use-cases/login.use-case';
import { LogoutAllUseCase } from './application/use-cases/logout-all.use-case';
import { LogoutUseCase } from './application/use-cases/logout.use-case';
import { RefreshSessionUseCase } from './application/use-cases/refresh-session.use-case';
import { UpdateMeUseCase } from './application/use-cases/update-me.use-case';
import type { PasswordPolicy } from './domain/password-policy';
import { CryptoRefreshTokenFactory } from './infrastructure/security/crypto-refresh-token-factory';
import { JoseAccessTokenService } from './infrastructure/security/jose-access-token-service';
import { AuthController } from './presentation/auth.controller';
import { authRoutes } from './presentation/auth.routes';
import { createAvatarWiring, type AuthAvatarDeps, type AvatarWiring } from './avatar.wiring';
import { createAuthenticate } from './presentation/authenticate';
import { RefreshCookie } from './presentation/refresh-cookie';

export interface AuthRepositories {
  users: IUserRepository;
  refreshTokens: IRefreshTokenRepository;
  sessions: ISessionRevocationStore;
  activationTokens: IActivationTokenRepository;
}

export { createInMemoryAuthRepositories } from './infrastructure/persistence/in-memory/in-memory-auth-repositories';

export const JWT_ISSUER = 'taskflow-api';
export const JWT_AUDIENCE = 'taskflow-web';

export interface AuthModuleDeps {
  repos: AuthRepositories;
  hasher: IPasswordHasher;
  policy: PasswordPolicy;
  jwt: { secret: string; previousSecret?: string | undefined; ttlSeconds?: number | undefined };
  cookieSecure: boolean;
  /** Middleware Origin ∈ whitelist cho /refresh, /logout. */
  requireAllowedOrigin: RequestHandler;
  /** Port do module Workspace / company hiện thực — wire ở composition root (ADR-093). */
  memberships: IMembershipReader;
  company: ICompanySessionGate;
  webOrigin: string; // gốc link `<webOrigin>/activate#t=…`
  notifier: IAuthRealtimeNotifier;
  uow: IUnitOfWork;
  events: IEventBus;
  ids: IIdGenerator;
  clock: IClock;
  /** Giờ NGHIỆP VỤ cho `expires_at` token kích hoạt (CLI + API cùng mốc TEST_CLOCK_ANCHOR); thiếu ⇒ `clock`. */
  activationClock?: IClock;
  logger: ILogger;
  responder: HttpResponder;
  limit: (rules: readonly RateLimitRule[]) => RequestHandler[];
  /** Thay JWT thật trong test (cùng interface). */
  accessTokens?: IAccessTokenService;
  /** Mốc 6 (ADR-142): ảnh đại diện — thiếu ⇒ không có `/me/avatar`, UserDto không có ảnh (test cũ). */
  avatar?: AuthAvatarDeps;
}

export type { AuthAvatarDeps } from './avatar.wiring';

export interface AuthModule {
  router: Router;
  /** Middleware `authenticate` cho router của module khác. */
  authenticate: RequestHandler;
  /** Lõi xác thực — gateway Socket.io bọc bằng `socketAuthenticatorFrom`. */
  authenticator: AccessTokenAuthenticator;
  /** Tài khoản cho module company (thêm nhân viên / bootstrap) — gọi TRONG transaction của bên gọi. */
  accounts: AuthAccounts;
  /** Mốc 6: router `/me` (`/me/avatar`) + gỡ ảnh cho company (HR) — chỉ khi có `deps.avatar`. */
  avatar?: AvatarWiring;
}

/** Composition của module auth (ADR-016): chỉ wire nội bộ module, port ngoài được tiêm vào. */
export function createAuthModule(d: AuthModuleDeps): AuthModule {
  const { users, refreshTokens, sessions: store, activationTokens } = d.repos;
  const { uow, clock, logger, events, ids, hasher, policy, notifier } = d;
  const accessTokens =
    d.accessTokens ??
    new JoseAccessTokenService(
      {
        secret: d.jwt.secret,
        previousSecret: d.jwt.previousSecret,
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        // Rút ngắn chỉ ở APP_ENV=test (env.ts); thu hồi phiên vẫn giữ ACCESS_TOKEN_TTL_SECONDS (≥ TTL).
        ttlSeconds: d.jwt.ttlSeconds ?? ACCESS_TOKEN_TTL_SECONDS,
      },
      clock,
    );
  const refreshTokenFactory = new CryptoRefreshTokenFactory();
  const issuer = new SessionIssuer({
    refreshTokens,
    refreshTokenFactory,
    accessTokens,
    ids,
    clock,
  });
  const authenticator = new AccessTokenAuthenticator({
    accessTokens,
    store,
    users,
    refreshTokens,
    logger,
    clock,
  });
  const authenticate = createAuthenticate(authenticator);
  const company = d.company;
  const activation = createActivation({
    tokens: activationTokens,
    factory: refreshTokenFactory,
    users,
    company,
    clock: d.activationClock ?? clock,
    ids,
    webOrigin: d.webOrigin,
    hasher,
    policy,
    issuer,
    uow,
    logger,
  });

  const avatar = d.avatar && createAvatarWiring({ ...d, avatar: d.avatar, users, authenticate });
  const controller = new AuthController({
    login: new LoginUseCase({ users, issuer, hasher, company, uow, clock, logger }),
    inspectActivation: activation.inspect,
    activate: activation.activate,
    refresh: new RefreshSessionUseCase({
      users,
      refreshTokens,
      refreshTokenFactory,
      issuer,
      store,
      notifier,
      company,
      uow,
      clock,
      logger,
    }),
    logout: new LogoutUseCase({
      refreshTokens,
      refreshTokenFactory,
      store,
      notifier,
      uow,
      clock,
      logger,
    }),
    logoutAll: new LogoutAllUseCase({
      users,
      refreshTokens,
      store,
      notifier,
      events,
      uow,
      clock,
      logger,
    }),
    getMe: new GetMeQuery({ users, memberships: d.memberships, company }),
    updateMe: new UpdateMeUseCase({ users, uow, clock }),
    changePassword: new ChangePasswordUseCase({
      users,
      refreshTokens,
      issuer,
      hasher,
      policy,
      store,
      notifier,
      events,
      uow,
      clock,
      logger,
    }),
    cookie: new RefreshCookie(d.cookieSecure, clock),
    responder: d.responder,
    logger,
    ...(avatar ? { avatarOf: avatar.avatarOf } : {}),
  });
  const router = authRoutes({
    controller,
    authenticate,
    requireAllowedOrigin: d.requireAllowedOrigin,
    limit: d.limit,
  });
  const accounts = createAuthAccounts({
    ...(avatar ? { removeAvatar: (i) => avatar.removeAvatar.execute(i) } : {}),
    users,
    refreshTokens,
    store,
    notifier,
    activationIssuer: activation.issuer,
    ids,
    clock,
    uow,
    logger,
  });
  return { router, authenticate, authenticator, accounts, ...(avatar ? { avatar } : {}) };
}
