import type { IDomainEvent } from '../../../core/domain';

/** Đăng ký mới — dành cho listener sau này (email chào mừng…), không mang PII. */
export interface UserRegistered extends IDomainEvent {
  readonly type: 'UserRegistered';
}

/** Đổi mật khẩu — mọi phiên cũ đã bị thu hồi (security.md 1.7). */
export interface UserPasswordChanged extends IDomainEvent {
  readonly type: 'UserPasswordChanged';
}

/** Đăng xuất mọi thiết bị (security.md 1.6). */
export interface UserSessionsRevoked extends IDomainEvent {
  readonly type: 'UserSessionsRevoked';
}

export type UserEvent = UserRegistered | UserPasswordChanged | UserSessionsRevoked;
