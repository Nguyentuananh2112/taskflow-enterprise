import type { IActivationTokenRepository } from './application/ports/activation-token-repository.port';
import type { IPrivacyStore } from './application/ports/privacy.port';
import type { IRefreshTokenRepository } from './application/ports/refresh-token-repository.port';
import type { ISessionRevocationStore } from './application/ports/session-revocation-store.port';
import type { IUserRepository } from './application/ports/user-repository.port';

export interface AuthRepositories {
  users: IUserRepository;
  refreshTokens: IRefreshTokenRepository;
  sessions: ISessionRevocationStore;
  activationTokens: IActivationTokenRepository;
  /** T-075: xác nhận thông báo quyền riêng tư + đồng ý lý do nghỉ (cột trên `users`). */
  privacy: IPrivacyStore;
}
