import type {
  ActivateBody,
  ActivationInspectBody,
  ChangePasswordBody,
  LoginBody,
  UpdateMeBody,
} from '@taskflow/contracts';
import type { Request, Response } from 'express';

import { RefreshTokenInvalidError, SessionRevokedError } from '../../../core/errors';
import type { HttpResponder } from '../../../core/http/envelope';
import type { ILogger } from '../../../core/logging/logger';
import { requireUser, sessionMetaOf } from '../../../core/http/request-user';
import type { IssuedSession } from '../application/session-issuer';
import type {
  ActivateAccountUseCase,
  InspectActivationQuery,
} from '../application/use-cases/activation.use-cases';
import type { ChangePasswordUseCase } from '../application/use-cases/change-password.use-case';
import type { GetMeQuery } from '../application/use-cases/get-me.query';
import type { LoginUseCase } from '../application/use-cases/login.use-case';
import type { LogoutAllUseCase } from '../application/use-cases/logout-all.use-case';
import type { LogoutUseCase } from '../application/use-cases/logout.use-case';
import type { RefreshSessionUseCase } from '../application/use-cases/refresh-session.use-case';
import type { UpdateMeUseCase } from '../application/use-cases/update-me.use-case';
import type { AvatarUrls } from '../application/ports/avatar.port';
import { MAX_REFRESH_COOKIES, type RefreshCookie } from './refresh-cookie';

export interface AuthControllerDeps {
  login: Pick<LoginUseCase, 'execute'>;
  inspectActivation: Pick<InspectActivationQuery, 'execute'>;
  activate: Pick<ActivateAccountUseCase, 'execute'>;
  refresh: Pick<RefreshSessionUseCase, 'execute'>;
  logout: Pick<LogoutUseCase, 'execute'>;
  logoutAll: Pick<LogoutAllUseCase, 'execute'>;
  getMe: Pick<GetMeQuery, 'execute'>;
  updateMe: Pick<UpdateMeUseCase, 'execute'>;
  changePassword: Pick<ChangePasswordUseCase, 'execute'>;
  cookie: RefreshCookie;
  responder: HttpResponder;
  logger: ILogger;
  /** Mốc 6 (ADR-142): ảnh của người đang đăng nhập (64 + 256) cho `UserDto`; thiếu ⇒ không gắn (test cũ). */
  avatarOf?: (userId: string) => Promise<AvatarUrls | null>;
}

/** Controller mỏng (ADR-015): parse đã xong ở `validate`, chỉ gọi use case + dựng response/cookie. */
export class AuthController {
  constructor(private readonly d: AuthControllerDeps) {}

  /** `UserDto.avatarUrl` (64) + `avatarUrlLarge` (256) — null khi chưa có ảnh. */
  async #withAvatar<T extends { id: string }>(user: T) {
    if (!this.d.avatarOf) return user;
    const urls = await this.d.avatarOf(user.id);
    return {
      ...user,
      avatarUrl: urls?.avatarUrl ?? null,
      avatarUrlLarge: urls?.avatarUrlLarge ?? null,
    };
  }

  #issue(res: Response, session: IssuedSession) {
    this.d.cookie.set(res, session.refreshToken, session.refreshExpiresAt);
    return { accessToken: session.accessToken, expiresIn: session.expiresIn };
  }

  inspectActivation = async (req: Request, res: Response) => {
    const { token } = req.body as ActivationInspectBody;
    this.d.responder.ok(res, await this.d.inspectActivation.execute({ token }));
  };

  activate = async (req: Request, res: Response) => {
    const body = req.body as ActivateBody;
    const result = await this.d.activate.execute({ ...body, meta: sessionMetaOf(req) });
    const user = await this.#withAvatar(result.user);
    this.d.responder.ok(res, { ...this.#issue(res, result.session), user });
  };

  login = async (req: Request, res: Response) => {
    const body = req.body as LoginBody;
    const result = await this.d.login.execute({ ...body, meta: sessionMetaOf(req) });
    const user = await this.#withAvatar(result.user);
    this.d.responder.ok(res, { ...this.#issue(res, result.session), user });
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
      // Hết quyền công ty (SEC-HR-69) cũng xóa cookie: phiên này không bao giờ refresh được nữa.
      if (err instanceof RefreshTokenInvalidError || err instanceof SessionRevokedError) {
        this.d.cookie.clear(res);
      }
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
    const count = this.d.cookie.readAll(req).length;
    if (count > MAX_REFRESH_COOKIES) {
      this.#ambiguous(req, count);
      throw new RefreshTokenInvalidError();
    }
  }

  /** Dấu hiệu cookie tossing (X9): nhiều cookie refresh trùng tên chỉ có thể do bên thứ ba cài. */
  #ambiguous(req: Request, count: number): void {
    this.d.logger.warn({ count, ip: req.ip ?? null }, 'auth.refresh_cookie_ambiguous');
  }

  async #revokeIfAmbiguous(req: Request): Promise<void> {
    const values = this.d.cookie.readAll(req);
    if (values.length < 2) return;
    this.#ambiguous(req, values.length);
    for (const refreshToken of values) await this.d.logout.execute({ refreshToken });
    throw new RefreshTokenInvalidError();
  }

  logoutAll = async (req: Request, res: Response) => {
    await this.d.logoutAll.execute({ userId: requireUser(req).id });
    this.d.cookie.clear(res);
    res.status(204).end();
  };

  me = async (req: Request, res: Response) => {
    const me = await this.d.getMe.execute({ userId: requireUser(req).id });
    this.d.responder.ok(res, { ...me, user: await this.#withAvatar(me.user) });
  };

  updateMe = async (req: Request, res: Response) => {
    const { fullName } = req.body as UpdateMeBody;
    const user = await this.d.updateMe.execute({ userId: requireUser(req).id, fullName });
    this.d.responder.ok(res, await this.#withAvatar(user));
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
