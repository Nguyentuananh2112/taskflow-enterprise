// Public API của module auth (ADR-093; quyết định Tech Lead ở T-015): CHỈ export TYPE.
// Module khác dùng `import type` qua file này để khai báo `implements` port do auth định nghĩa.
// Không export class/giá trị runtime — phụ thuộc giữa module chỉ một chiều và chỉ ở mức type
// (test index.test.ts chặn việc lỡ thêm export runtime).
export type {
  IAuthRealtimeNotifier,
  ICompanySessionGate,
  IMembershipReader,
  MeCompanyView,
  MembershipView,
} from './application/ports/collaborators.port';
export type { AuthAccounts } from './application/auth-accounts';
export type { AuthenticatedUser } from './application/access-token-authenticator';
