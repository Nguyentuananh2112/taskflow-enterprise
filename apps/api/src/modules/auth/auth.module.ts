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
import type {
  IAuthRealtimeNotifier,
  IMembershipReader,
  IWorkspaceProvisioner,
} from './application/ports/collaborators.port';
import type { IPasswordHasher } from './application/ports/password-hasher.port';
import type { IRefreshTokenRepository } from './application/ports/refresh-token-repository.port';
import type { ISessionRevocationStore } from './application/ports/session-revocation-store.port';
import type { IUserRepository } from './application/ports/user-repository.port';
import { SessionIssuer } from './application/session-issuer';
import { ChangePasswordUseCase } from './application/use-cases/change-password.use-case';
import { GetMeQuery } from './application/use-cases/get-me.query';
import { LoginUseCase } from './application/use-cases/login.use-case';
import { LogoutAllUseCase } from './application/use-cases/logout-all.use-case';
import { LogoutUseCase } from './application/use-cases/logout.use-case';
import { RefreshSessionUseCase } from './application/use-cases/refresh-session.use-case';
import { RegisterUseCase } from './application/use-cases/register.use-case';
import { UpdateMeUseCase } from './application/use-cases/update-me.use-case';
import type { PasswordPolicy } from './domain/password-policy';
import { InMemoryRefreshTokenRepository } from './infrastructure/persistence/in-memory/in-memory-refresh-token.repository';
import { InMemorySessionRevocationStore } from './infrastructure/persistence/in-memory/in-memory-session-revocation.store';
import { InMemoryUserRepository } from './infrastructure/persistence/in-memory/in-memory-user.repository';
import { CryptoRefreshTokenFactory } from './infrastructure/security/crypto-refresh-token-factory';
import { JoseAccessTokenService } from './infrastructure/security/jose-access-token-service';
import { AuthController } from './presentation/auth.controller';
import { authRoutes } from './presentation/auth.routes';
import { createAuthenticate } from './presentation/authenticate';
import { RefreshCookie } from './presentation/refresh-cookie';

export interface AuthRepositories {
  users: IUserRepository;
  refreshTokens: IRefreshTokenRepository;
  sessions: ISessionRevocationStore;
}

/** Repository InMemory (dev/test). Prisma/Valkey của T-020 thay qua cùng interface. */
export function createInMemoryAuthRepositories() {
  return {
    users: new InMemoryUserRepository(),
    refreshTokens: new InMemoryRefreshTokenRepository(),
    sessions: new InMemorySessionRevocationStore(),
  };
}

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
  /** Port do module Workspace hiện thực — wire ở composition root (ADR-093). */
  provisioner: IWorkspaceProvisioner;
  memberships: IMembershipReader;
  notifier: IAuthRealtimeNotifier;
  uow: IUnitOfWork;
  events: IEventBus;
  ids: IIdGenerator;
  clock: IClock;
  logger: ILogger;
  responder: HttpResponder;
  limit: (rules: readonly RateLimitRule[]) => RequestHandler[];
  /** Thay JWT thật trong test (cùng interface). */
  accessTokens?: IAccessTokenService;
}

export interface AuthModule {
  router: Router;
  /** Middleware `authenticate` cho router của module khác. */
  authenticate: RequestHandler;
  /** Lõi xác thực — gateway Socket.io bọc bằng `socketAuthenticatorFrom`. */
  authenticator: AccessTokenAuthenticator;
}

/** Composition của module auth (ADR-016): chỉ wire nội bộ module, port ngoài được tiêm vào. */
export function createAuthModule(d: AuthModuleDeps): AuthModule {
  const { users, refreshTokens, sessions: store } = d.repos;
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
  });
  const authenticate = createAuthenticate(authenticator);

  const controller = new AuthController({
    register: new RegisterUseCase({
      users,
      provisioner: d.provisioner,
      issuer,
      hasher,
      policy,
      uow,
      events,
      ids,
      clock,
    }),
    login: new LoginUseCase({ users, issuer, hasher, uow, clock, logger }),
    refresh: new RefreshSessionUseCase({
      users,
      refreshTokens,
      refreshTokenFactory,
      issuer,
      store,
      notifier,
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
    getMe: new GetMeQuery({ users, memberships: d.memberships }),
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
  });
  const router = authRoutes({
    controller,
    authenticate,
    requireAllowedOrigin: d.requireAllowedOrigin,
    limit: d.limit,
  });
  return { router, authenticate, authenticator };
}
