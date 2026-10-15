import { AuthDomainError } from './auth-domain-error';

const MAX_LENGTH = 254; // khớp users.email VarChar(254)
const MAX_LOCAL_LENGTH = 64;
const WHITESPACE = /\s/u;

/**
 * Email đã chuẩn hóa: trim → NFC → lowercase (security.md 1.1, data-and-api.md 2.4).
 * Chỉ kiểm tra hình dạng cơ bản — không cố bao quát RFC 5322; Zod ở biên kiểm tra thêm.
 */
export class Email {
  private constructor(readonly value: string) {}

  static create(raw: string): Email {
    const value = raw.trim().normalize('NFC').toLowerCase();
    if (!Email.isWellFormed(value)) {
      // Không đưa giá trị vào message: email là PII, message có thể vào log.
      throw new AuthDomainError('INVALID_EMAIL', 'Email không hợp lệ');
    }
    return new Email(value);
  }

  get localPart(): string {
    return this.value.slice(0, this.value.indexOf('@'));
  }

  equals(other: Email): boolean {
    return this.value === other.value;
  }

  private static isWellFormed(value: string): boolean {
    if (value.length === 0 || value.length > MAX_LENGTH || WHITESPACE.test(value)) return false;
    const parts = value.split('@');
    if (parts.length !== 2) return false;
    const [local = '', domain = ''] = parts;
    if (local.length === 0 || local.length > MAX_LOCAL_LENGTH) return false;
    const labels = domain.split('.');
    return labels.length >= 2 && labels.every((label) => label.length > 0);
  }
}
