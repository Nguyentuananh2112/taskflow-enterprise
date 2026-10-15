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

  /**
   * Đọc từ header Cookie (không cần cookie-parser). Nhiều cookie trùng tên ⇒ coi như KHÔNG có
   * (T-028): cookie của ta host-only nên chỉ có một; cookie thứ hai chỉ có thể do subdomain anh em
   * đặt với `Domain=` (cookie tossing) — lấy "cái đầu" sẽ đăng nhập nạn nhân vào phiên kẻ tấn công.
   * Khi trùng, controller thu hồi MỌI token qua `readAll` (xem `AuthController`).
   */
  read(req: Request): string | undefined {
    const values = this.readAll(req);
    return values.length === 1 ? values[0] : undefined;
  }

  /** Mọi giá trị hợp lệ (giải mã được, không rỗng) của cookie mang tên này. */
  readAll(req: Request): string[] {
    const values: string[] = [];
    for (const part of (req.headers.cookie ?? '').split(';')) {
      const eq = part.indexOf('=');
      if (eq < 0 || part.slice(0, eq).trim() !== this.name) continue;
      try {
        const value = decodeURIComponent(part.slice(eq + 1).trim());
        if (value) values.push(value);
      } catch {
        // sai mã hóa ⇒ bỏ qua giá trị này
      }
    }
    return values;
  }
}
