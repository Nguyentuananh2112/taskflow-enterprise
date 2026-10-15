import type {
  ChangePasswordBody,
  LoginBody,
  RegisterBody,
  UpdateMeBody,
} from '@taskflow/contracts';
import type { Request, Response } from 'express';

import { RefreshTokenInvalidError } from '../../../core/errors';
import type { HttpResponder } from '../../../core/http/envelope';
import { requireUser, sessionMetaOf } from '../../../core/http/request-user';
import type { IssuedSession } from '../application/session-issuer';
import type { ChangePasswordUseCase } from '../application/use-cases/change-password.use-case';
import type { GetMeQuery } from '../application/use-cases/get-me.query';
import type { LoginUseCase } from '../application/use-cases/login.use-case';
import type { LogoutAllUseCase } from '../application/use-cases/logout-all.use-case';
import type { LogoutUseCase } from '../application/use-cases/logout.use-case';
import type { RefreshSessionUseCase } from '../application/use-cases/refresh-session.use-case';
import type { RegisterUseCase } from '../application/use-cases/register.use-case';
import type { UpdateMeUseCase } from '../application/use-cases/update-me.use-case';
import type { RefreshCookie } from './refresh-cookie';

export interface AuthControllerDeps {
  register: Pick<RegisterUseCase, 'execute'>;
  login: Pick<LoginUseCase, 'execute'>;
  refresh: Pick<RefreshSessionUseCase, 'execute'>;
  logout: Pick<LogoutUseCase, 'execute'>;
  logoutAll: Pick<LogoutAllUseCase, 'execute'>;
  getMe: Pick<GetMeQuery, 'execute'>;
  updateMe: Pick<UpdateMeUseCase, 'execute'>;
  changePassword: Pick<ChangePasswordUseCase, 'execute'>;
  cookie: RefreshCookie;
  responder: HttpResponder;
}

/** Controller mỏng (ADR-015): parse đã xong ở `validate`, chỉ gọi use case + dựng response/cookie. */
export class AuthController {
  constructor(private readonly d: AuthControllerDeps) {}

  #issue(res: Response, session: IssuedSession) {
    this.d.cookie.set(res, session.refreshToken, session.refreshExpiresAt);
    return { accessToken: session.accessToken, expiresIn: session.expiresIn };
  }

  register = async (req: Request, res: Response) => {
    const body = req.body as RegisterBody;
    const result = await this.d.register.execute({ ...body, meta: sessionMetaOf(req) });
    const tokens = this.#issue(res, result.session);
    this.d.responder.created(res, {
      ...tokens,
      user: result.user,
      defaultWorkspaceId: result.defaultWorkspaceId,
    });
  };

  login = async (req: Request, res: Response) => {
    const body = req.body as LoginBody;
    const result = await this.d.login.execute({ ...body, meta: sessionMetaOf(req) });
    this.d.responder.ok(res, { ...this.#issue(res, result.session), user: result.user });
  };

  /** Lỗi `REFRESH_TOKEN_INVALID` ⇒ xóa cookie (security §1.4); `REFRESH_IN_PROGRESS` giữ cookie. */
  refresh = async (req: Request, res: Response) => {
    try {
      const result = await this.d.refresh.execute({
        refreshToken: this.d.cookie.read(req),
        meta: sessionMetaOf(req),
      });
      this.d.responder.ok(res, this.#issue(res, result.session));
    } catch (err) {
      if (err instanceof RefreshTokenInvalidError) this.d.cookie.clear(res);
      throw err;
    }
  };

  /** Idempotent: luôn 204 + xóa cookie. */
  logout = async (req: Request, res: Response) => {
    await this.d.logout.execute({ refreshToken: this.d.cookie.read(req) });
    this.d.cookie.clear(res);
    res.status(204).end();
  };

  logoutAll = async (req: Request, res: Response) => {
    await this.d.logoutAll.execute({ userId: requireUser(req).id });
    this.d.cookie.clear(res);
    res.status(204).end();
  };

  me = async (req: Request, res: Response) => {
    this.d.responder.ok(res, await this.d.getMe.execute({ userId: requireUser(req).id }));
  };

  updateMe = async (req: Request, res: Response) => {
    const { fullName } = req.body as UpdateMeBody;
    this.d.responder.ok(
      res,
      await this.d.updateMe.execute({ userId: requireUser(req).id, fullName }),
    );
  };

  changePassword = async (req: Request, res: Response) => {
    const body = req.body as ChangePasswordBody;
    const result = await this.d.changePassword.execute({
      userId: requireUser(req).id,
      ...body,
      meta: sessionMetaOf(req),
    });
    this.d.responder.ok(res, this.#issue(res, result.session));
  };
}
