import type { QueryClient, QueryKey } from '@tanstack/react-query';

import type {
  MeWithAvatarResponse,
  UserWithAvatarDto,
} from '@/shared/api/pending-contracts/avatar';

import { session } from './session';
import { sessionStore } from './session-store';
import { sessionKeys } from './use-me';

// Avatar đổi (của mình hoặc người khác — `user:avatar-changed`, ADR-142 / §7 E1) ⇒ làm mới mọi query đang hiển thị
// `UserRefDto.avatarUrl`. Danh sách theo ADR-142: /auth/me, task (board), thành viên ws + ứng viên, audit task, thông
// báo. DTO attendance/leave/hr/payroll CHƯA có avatar (đội Mốc 4/5 thêm sau) ⇒ không làm mới.

const WS_PARTS_WITH_USERS = new Set(['members', 'board', 'audit']);

export function showsAvatars(key: QueryKey): boolean {
  const [root] = key;
  if (root === sessionKeys.me[0] || root === 'notifications') return true;
  return (
    root === 'ws' && key.some((part) => typeof part === 'string' && WS_PARTS_WITH_USERS.has(part))
  );
}

/** Chỉ query đang mở mới tải lại (TanStack mặc định) — trang khác tự tải khi mở. */
export function invalidateAvatarViews(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ predicate: (q) => showsAvatars(q.queryKey) });
}

type AvatarFields = Pick<UserWithAvatarDto, 'avatarUrl' | 'avatarUrlLarge'>;

/** Ảnh của CHÍNH MÌNH vừa đổi ở tab này: cập nhật ngay header + /account, rồi làm mới chỗ khác. */
export function applyMyAvatar(queryClient: QueryClient, fields: AvatarFields): void {
  queryClient.setQueryData<MeWithAvatarResponse>(
    sessionKeys.me,
    (old) => old && { ...old, user: { ...old.user, ...fields } },
  );
  const { user } = sessionStore.get();
  if (user) session.updateUser({ ...user, ...fields });
  void queryClient.invalidateQueries({
    predicate: (q) => q.queryKey[0] !== sessionKeys.me[0] && showsAvatars(q.queryKey),
  });
}
