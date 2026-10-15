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
import { MAX_REFRESH_COOKIES, type RefreshCookie } from './refresh-cookie';

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
    this.#rejectFlood(req);
    try {
      await this.#revokeIfAmbiguous(req);
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

  /** Idempotent: luôn 204 + xóa cookie. Cookie trùng tên ⇒ thu hồi family của MỌI giá trị. */
  logout = async (req: Request, res: Response) => {
    this.#rejectFlood(req);
    for (const refreshToken of this.d.cookie.readAll(req)) {
      await this.d.logout.execute({ refreshToken });
    }
    this.d.cookie.clear(res);
    res.status(204).end();
  };

  /**
   * Cookie tossing (T-028, finding của F): subdomain anh em đặt `tf_rt` với `Domain=` — `clear()`
   * host-only chỉ xóa được cookie của nạn nhân, cookie kẻ tấn công ở lại và lần refresh sau sẽ
   * đăng nhập nạn nhân vào phiên của chúng. Không biết cái nào là thật ⇒ thu hồi family của MỌI
   * giá trị (như logout) rồi mới báo `REFRESH_TOKEN_INVALID`: cookie còn sót lại đều đã chết.
   * Nạn nhân phải đăng nhập lại — chấp nhận khi đang bị tấn công. Gốc rễ: tiền tố `__Host-`.
   */
  /**
   * Quá `MAX_REFRESH_COOKIES` giá trị trùng tên ⇒ 401 NGAY, không thu hồi từng cái (một header
   * Cookie 16KB chứa ~50 giá trị ⇒ khuếch đại DB/Valkey) và KHÔNG xóa cookie: cookie host-only của
   * nạn nhân còn đó nên lần sau vẫn là "trùng" ⇒ không thể hoán đổi phiên.
   */
  #rejectFlood(req: Request): void {
    if (this.d.cookie.readAll(req).length > MAX_REFRESH_COOKIES)
      throw new RefreshTokenInvalidError();
  }

  async #revokeIfAmbiguous(req: Request): Promise<void> {
    const values = this.d.cookie.readAll(req);
    if (values.length < 2) return;
    for (const refreshToken of values) await this.d.logout.execute({ refreshToken });
    throw new RefreshTokenInvalidError();
  }

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
      ...body, // trường do server suy ra đặt SAU body: body không bao giờ ghi đè được (T-028)
      userId: requireUser(req).id,
      meta: sessionMetaOf(req),
    });
    this.d.responder.ok(res, this.#issue(res, result.session));
  };
}
