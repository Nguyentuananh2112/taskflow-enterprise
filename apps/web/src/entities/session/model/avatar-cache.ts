import type { QueryClient, QueryKey } from '@tanstack/react-query';

import type { MeResponse, UserDto } from '@taskflow/contracts/auth';

import { authApi } from '../api/auth.api';
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

/**
 * `user:avatar-changed` của `userId`. Chỉ query đang mở mới tải lại (TanStack mặc định) — trang khác tự tải khi mở.
 * Của CHÍNH MÌNH (tab / thiết bị khác) ⇒ tải lại `/auth/me` rồi đồng bộ người dùng của phiên: header đọc từ phiên,
 * không từ query `me`.
 */
export async function invalidateAvatarViews(
  queryClient: QueryClient,
  userId: string,
): Promise<void> {
  const mine = sessionStore.get().user?.id === userId;
  await queryClient.invalidateQueries({
    predicate: (q) => (!mine || q.queryKey[0] !== sessionKeys.me[0]) && showsAvatars(q.queryKey),
  });
  if (!mine) return;
  const me = await queryClient.fetchQuery({
    queryKey: sessionKeys.me,
    queryFn: authApi.me,
    staleTime: 0, // cache `me` còn "tươi" 5 phút — event nói nó đã cũ
  });
  const { user } = sessionStore.get();
  if (user?.id === me.user.id) {
    session.updateUser({
      ...user,
      avatarUrl: me.user.avatarUrl,
      avatarUrlLarge: me.user.avatarUrlLarge,
    });
  }
}

type AvatarFields = Pick<UserDto, 'avatarUrl' | 'avatarUrlLarge'>;

/** Ảnh của CHÍNH MÌNH vừa đổi ở tab này: cập nhật ngay header + /account, rồi làm mới chỗ khác. */
export function applyMyAvatar(queryClient: QueryClient, fields: AvatarFields): void {
  queryClient.setQueryData<MeResponse>(
    sessionKeys.me,
    (old) => old && { ...old, user: { ...old.user, ...fields } },
  );
  const { user } = sessionStore.get();
  if (user) session.updateUser({ ...user, ...fields });
  void queryClient.invalidateQueries({
    predicate: (q) => q.queryKey[0] !== sessionKeys.me[0] && showsAvatars(q.queryKey),
  });
}
