import { AggregateRoot } from '../../../core/domain';
import { ValidationError } from '../../../core/errors';
import { Email } from './email';
import type { UserEvent } from './user-events';

const FULL_NAME_MAX = 100;
const CONTROL_CHARS = /\p{Cc}/u;

/** Trạng thái lưu trữ (repository map sang/từ đây). `email` đã chuẩn hóa. */
export interface UserSnapshot {
  id: string;
  email: string;
  /** null = chờ kích hoạt (ADR-137): đăng nhập như không có user, chỉ `POST /auth/activate` đặt được. */
  passwordHash: string | null;
  fullName: string;
  tokenVersion: number;
  passwordChangedAt: Date | null;
  lastLoginAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** fullName: trim, 1–100 ký tự (code point), không ký tự điều khiển (data-and-api.md 2.4). */
function normalizeFullName(raw: string): string {
  const value = raw.trim();
  const length = [...value].length;
  const fail = (code: string, message: string) =>
    new ValidationError([{ path: ['fullName'], code, message }]);
  if (length === 0) throw fail('too_small', 'Họ tên không được để trống.');
  if (length > FULL_NAME_MAX) throw fail('too_big', `Họ tên tối đa ${FULL_NAME_MAX} ký tự.`);
  if (CONTROL_CHARS.test(value)) throw fail('invalid_format', 'Họ tên chứa ký tự không hợp lệ.');
  return value;
}

/** Aggregate người dùng (ADR-024/025). Thay đổi `tokenVersion` ⇒ mọi access token cũ chết. */
export class User extends AggregateRoot<UserEvent> {
  private constructor(
    id: string,
    private state: Omit<UserSnapshot, 'id' | 'email'> & { email: Email },
  ) {
    super(id);
  }

  /** Kiểm họ tên mà không tạo user — dùng để báo lỗi trước khi băm mật khẩu (REG-08). */
  static validateFullName(raw: string): string {
    return normalizeFullName(raw);
  }

  /** Tạo tài khoản — `passwordHash: null` khi HR thêm nhân viên / bootstrap (chờ kích hoạt). */
  static register(input: {
    id: string;
    email: Email;
    passwordHash: string | null;
    fullName: string;
    now: Date;
  }): User {
    const user = new User(input.id, {
      email: input.email,
      passwordHash: input.passwordHash,
      fullName: normalizeFullName(input.fullName),
      tokenVersion: 0,
      passwordChangedAt: null,
      lastLoginAt: null,
      deletedAt: null,
      createdAt: input.now,
      updatedAt: input.now,
    });
    user.addDomainEvent({ type: 'UserRegistered', aggregateId: input.id, occurredAt: input.now });
    return user;
  }

  static reconstitute(snapshot: UserSnapshot): User {
    const { id, email, ...rest } = snapshot;
    return new User(id, { ...rest, email: Email.create(email) });
  }

  get email(): Email {
    return this.state.email;
  }
  get passwordHash(): string | null {
    return this.state.passwordHash;
  }
  get fullName(): string {
    return this.state.fullName;
  }
  get tokenVersion(): number {
    return this.state.tokenVersion;
  }
  get passwordChangedAt(): Date | null {
    return this.state.passwordChangedAt;
  }
  get lastLoginAt(): Date | null {
    return this.state.lastLoginAt;
  }
  get updatedAt(): Date {
    return this.state.updatedAt;
  }
  get createdAt(): Date {
    return this.state.createdAt;
  }
  get isDeleted(): boolean {
    return this.state.deletedAt !== null;
  }

  recordLogin(now: Date): void {
    this.state.lastLoginAt = now;
    this.state.updatedAt = now;
  }

  /** Băm lại khi tham số argon2 đổi — cùng mật khẩu, không thu hồi phiên (security.md 1.2). */
  replacePasswordHash(passwordHash: string, now: Date): void {
    this.state.passwordHash = passwordHash;
    this.state.updatedAt = now;
  }

  changePassword(passwordHash: string, now: Date): void {
    this.state.passwordHash = passwordHash;
    this.state.passwordChangedAt = now;
    this.bumpTokenVersion(now);
    this.addDomainEvent({ type: 'UserPasswordChanged', aggregateId: this.id, occurredAt: now });
  }

  revokeAllSessions(now: Date): void {
    this.bumpTokenVersion(now);
    this.addDomainEvent({ type: 'UserSessionsRevoked', aggregateId: this.id, occurredAt: now });
  }

  rename(fullName: string, now: Date): void {
    this.state.fullName = normalizeFullName(fullName);
    this.state.updatedAt = now;
  }

  toSnapshot(): UserSnapshot {
    return { ...this.state, id: this.id, email: this.state.email.value };
  }

  private bumpTokenVersion(now: Date): void {
    this.state.tokenVersion += 1;
    this.state.updatedAt = now;
  }
}
