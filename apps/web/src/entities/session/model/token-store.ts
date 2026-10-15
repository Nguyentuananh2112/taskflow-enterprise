import type { AuthTokenDto } from '@taskflow/contracts/auth';

// Access token CHỈ nằm trong biến module này (ADR-026, security.md W-TOKEN-1): không React state,
// không window, không storage/URL/log. Reload trang ⇒ mất ⇒ bootstrap lại bằng /auth/refresh.

let accessToken: string | null = null;
let expiresAt = 0;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

export const tokenStore = {
  get: (): string | null => accessToken,
  /** Thời điểm hết hạn (ms epoch) — 0 khi chưa có token. */
  expiresAt: (): number => expiresAt,
  set(dto: AuthTokenDto, now: number = Date.now()): void {
    accessToken = dto.accessToken;
    expiresAt = now + dto.expiresIn * 1000;
    notify();
  },
  clear(): void {
    accessToken = null;
    expiresAt = 0;
    notify();
  },
  /** Báo khi token đổi (socket gửi `auth:renew` — frontend.md §3.5). Listener KHÔNG nhận token. */
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
