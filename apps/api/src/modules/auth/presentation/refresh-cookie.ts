import type { CookieOptions, Request, Response } from 'express';

import type { IClock } from '../../../core/domain';

export const REFRESH_COOKIE_PATH = '/api/v1/auth';

/**
 * Cookie refresh token (security.md §2.3): HttpOnly, SameSite=Strict, Path=/api/v1/auth, không
 * Domain (host-only). `secure` ⇒ thuộc tính Secure + tên `__Secure-tf_rt`; dev (http://localhost)
 * ⇒ `tf_rt` không Secure (trình duyệt từ chối tiền tố `__Secure-` trên localhost).
 */
export class RefreshCookie {
  readonly name: string;

  constructor(
    private readonly secure: boolean,
    private readonly clock: IClock,
  ) {
    this.name = secure ? '__Secure-tf_rt' : 'tf_rt';
  }

  #options(maxAgeMs: number): CookieOptions {
    return {
      httpOnly: true,
      secure: this.secure,
      sameSite: 'strict',
      path: REFRESH_COOKIE_PATH,
      maxAge: Math.max(0, maxAgeMs),
    };
  }

  /** Max-Age = thời gian còn lại tới `expiresAt` của refresh token. */
  set(res: Response, token: string, expiresAt: Date): void {
    res.cookie(this.name, token, this.#options(expiresAt.getTime() - this.clock.now().getTime()));
  }

  /** Xóa: cùng tên/Path, Max-Age=0. */
  clear(res: Response): void {
    res.cookie(this.name, '', this.#options(0));
  }

  /** Đọc từ header Cookie (không cần cookie-parser). Nhiều cookie trùng tên ⇒ lấy cái đầu. */
  read(req: Request): string | undefined {
    for (const part of (req.headers.cookie ?? '').split(';')) {
      const eq = part.indexOf('=');
      if (eq < 0 || part.slice(0, eq).trim() !== this.name) continue;
      const value = part.slice(eq + 1).trim();
      try {
        return decodeURIComponent(value) || undefined;
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}
