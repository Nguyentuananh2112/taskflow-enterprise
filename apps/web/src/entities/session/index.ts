// Public API của phiên. Cố ý KHÔNG xuất tokenStore (W-TOKEN-1: token chỉ sống trong slice này).
export { authApi } from './api/auth.api';
export { session, type EndReason } from './model/session';
export type { SessionState, SessionStatus } from './model/session-store';
export { sessionKeys, useMe } from './model/use-me';
export { applyMyAvatar, invalidateAvatarViews, showsAvatars } from './model/avatar-cache';
export { useCompanyPermission, type CompanyPermissionApi } from './model/use-company-permission';
export { useLogoutPending, useSession } from './model/use-session';
export { RateLimitedRetry } from './ui/rate-limited-retry';
