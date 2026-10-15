import type { ILogger } from '../../../core/logging/logger';
import { ValidationError } from '../../../core/errors';
import type { Email } from '../domain/email';
import type { PasswordPolicy, PasswordViolation } from '../domain/password-policy';
import type { User } from '../domain/user';

/** = TTL access token (security.md 2.1): `sid-revoked` chỉ cần sống đến khi token cuối của phiên hết hạn. */
export const ACCESS_TOKEN_TTL_SECONDS = 900;

export interface UserView {
  id: string;
  email: string;
  fullName: string;
  createdAt: Date;
}

export function toUserView(user: User): UserView {
  return {
    id: user.id,
    email: user.email.value,
    fullName: user.fullName,
    createdAt: user.createdAt,
  };
}

const VIOLATION_ISSUE: Record<PasswordViolation, { code: string; message: string }> = {
  TOO_SHORT: { code: 'too_small', message: 'Mật khẩu phải có ít nhất 12 ký tự.' },
  TOO_LONG: { code: 'too_big', message: 'Mật khẩu tối đa 256 ký tự.' },
  COMMON: { code: 'common_password', message: 'Mật khẩu quá phổ biến, hãy chọn mật khẩu khác.' },
  CONTAINS_EMAIL: { code: 'contains_email', message: 'Mật khẩu không được chứa email.' },
};

/** PasswordPolicy ⇒ `ValidationError` (400) với một issue cho mỗi vi phạm. */
export function assertPasswordAllowed(
  policy: PasswordPolicy,
  password: string,
  email: Email,
  field: 'password' | 'newPassword',
): void {
  const result = policy.check(password, email);
  if (result.ok) return;
  throw new ValidationError(
    result.violations.map((v) => ({ path: [field], ...VIOLATION_ISSUE[v] })),
  );
}

/**
 * Ghi cache sau commit: DB đã là nguồn sự thật, lỗi Valkey chỉ log cảnh báo (ALL-04) — không
 * làm hỏng thao tác người dùng đã thành công.
 */
export async function bestEffort(
  logger: ILogger,
  msg: string,
  data: Record<string, unknown>,
  action: () => Promise<void>,
): Promise<void> {
  try {
    await action();
  } catch (err) {
    logger.warn({ err, ...data }, msg);
  }
}
