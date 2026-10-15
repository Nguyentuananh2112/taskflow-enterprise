import type { Email } from './email';

export const PASSWORD_MIN_LENGTH = 12; // ADR-049
export const PASSWORD_MAX_LENGTH = 256; // ADR-065 — chống DoS, argon2 không có giới hạn đầu vào

/**
 * Ngưỡng rẻ trước khi chuẩn hóa: một ký tự (code point sau NFC) của mật khẩu hợp lệ không vượt
 * 4 UTF-16 unit ngay cả ở dạng NFD (vd "ệ" = 3 unit). Vượt ngưỡng ⇒ chắc chắn quá dài, khỏi tốn CPU
 * chuẩn hóa chuỗi khổng lồ (review T-013; body limit + Zod ở HTTP đã chặn trước — đây là lớp thứ hai).
 */
const MAX_UTF16_UNITS = PASSWORD_MAX_LENGTH * 4;

/** Phần local email ngắn hơn mức này thì không kiểm "chứa email" (tránh chặn oan, vd "a@x.vn"). */
const MIN_EMAIL_LOCAL_TO_CHECK = 3;

export type PasswordViolation = 'TOO_SHORT' | 'TOO_LONG' | 'COMMON' | 'CONTAINS_EMAIL';

export type PasswordCheckResult =
  { ok: true } | { ok: false; violations: readonly PasswordViolation[] };

/**
 * Chính sách mật khẩu (security.md 6.5). Thuần TS — danh sách mật khẩu phổ biến được tiêm vào
 * (infrastructure nạp file), các mục trong danh sách phải là chữ thường.
 */
export class PasswordPolicy {
  constructor(private readonly commonPasswords: ReadonlySet<string>) {}

  /** Dạng chuẩn duy nhất của mật khẩu — hasher dùng đúng hàm này trước khi hash VÀ verify. */
  static normalize(password: string): string {
    return password.normalize('NFC');
  }

  /** Số ký tự = số code point sau NFC (không phải UTF-16 code unit, không phải byte). */
  static length(password: string): number {
    return [...PasswordPolicy.normalize(password)].length;
  }

  /** Quá độ dài tối đa? Kiểm rẻ theo UTF-16 unit trước, chỉ chuẩn hóa khi chuỗi đủ ngắn. */
  static exceedsMaxLength(password: string): boolean {
    return (
      password.length > MAX_UTF16_UNITS || PasswordPolicy.length(password) > PASSWORD_MAX_LENGTH
    );
  }

  check(password: string, email?: Email): PasswordCheckResult {
    if (password.length > MAX_UTF16_UNITS) return { ok: false, violations: ['TOO_LONG'] };
    const normalized = PasswordPolicy.normalize(password);
    const length = [...normalized].length;
    const lower = normalized.toLowerCase();
    const violations: PasswordViolation[] = [];

    if (length < PASSWORD_MIN_LENGTH) violations.push('TOO_SHORT');
    if (length > PASSWORD_MAX_LENGTH) violations.push('TOO_LONG');
    if (this.commonPasswords.has(lower)) violations.push('COMMON');
    if (
      email &&
      email.localPart.length >= MIN_EMAIL_LOCAL_TO_CHECK &&
      lower.includes(email.localPart)
    ) {
      violations.push('CONTAINS_EMAIL');
    }

    return violations.length === 0 ? { ok: true } : { ok: false, violations };
  }
}
