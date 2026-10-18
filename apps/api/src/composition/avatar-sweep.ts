import type { IClock } from '../core/domain';
import { avatarFileKey } from '../core/files/domain/file-key';
import type { IFileSweepTask } from '../core/files/files-sweep';
import { STALE_TEMP_AGE_MS } from '../core/files/infrastructure/local-fs';
import type { IFileStore } from '../core/files/ports';
import type {
  AvatarSweepState,
  IAvatarDirectory,
} from '../modules/auth/application/ports/avatar-directory.port';
import type { AvatarVariant } from '../modules/auth/application/ports/avatar.port';
import type { IUserRepository } from '../modules/auth/application/ports/user-repository.port';

/** D13 (ADR-147): ảnh đã gỡ / người đã rời giữ 30 ngày rồi xóa — theo giờ NGHIỆP VỤ. */
export const AVATAR_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const VARIANTS: readonly AvatarVariant[] = ['256', '64'];

/** Chế độ bộ nhớ (local/test): version + còn dòng công ty; không có lịch sử rời ⇒ `leftAt` null. */
export function memoryAvatarDirectory(
  users: Pick<IUserRepository, 'avatarVersions' | 'setAvatarVersion'>,
  members: { find(userId: string): Promise<unknown> },
  clock: IClock,
): IAvatarDirectory {
  const isMember = async (id: string) => (await members.find(id)) !== null;
  return {
    async activeVersions(ids) {
      const versions = await users.avatarVersions(ids);
      const out = new Map<string, number>();
      for (const [id, v] of versions) if (await isMember(id)) out.set(id, v);
      return out;
    },
    async sweepStates(ids) {
      const versions = await users.avatarVersions(ids);
      const out = new Map<string, AvatarSweepState>();
      for (const id of new Set(ids)) {
        out.set(id, {
          version: versions.get(id) ?? null,
          member: await isMember(id),
          leftAt: null,
        });
      }
      return out;
    },
    async clearDeparted(ids) {
      let n = 0;
      for (const id of new Set(ids)) {
        if (!(await isMember(id)) && (await users.avatarVersions([id])).has(id)) {
          n += (await users.setAvatarVersion({ id, version: null, at: clock.now() })) ? 1 : 0;
        }
      }
      return n;
    },
  };
}

/**
 * Bước `avatars` của `files-sweep` (D13). Theo từng user có blob:
 * - còn thuộc công ty: blob ≠ version hiện tại (đổi ảnh xóa không được / ảnh đã gỡ / mồ côi của rollback) xóa khi đã
 *   quá 30 ngày theo giờ NGHIỆP VỤ (ảnh gỡ được `touch` = lúc gỡ). Blob version LỚN NHẤT còn mới (< 1 giờ giờ thật)
 *   được để yên — có thể là lần đặt ảnh đang chạy (đặt blob trước commit).
 * - đã rời / đã xóa: quá 30 ngày kể từ `left_at` (thiếu ⇒ mốc blob) ⇒ `avatar_version = NULL` TRƯỚC (DB), rồi xóa
 *   blob (đĩa). Nhận lại trong 30 ngày ⇒ lại là thành viên ⇒ giữ ảnh.
 */
export function avatarSweepTask(d: {
  store: IFileStore;
  directory: IAvatarDirectory;
  /** Giờ nghiệp vụ (30 ngày) và giờ thật (bảo vệ lần đặt ảnh đang chạy). */
  businessClock: IClock;
  clock: IClock;
}): IFileSweepTask {
  return {
    name: 'avatars',
    async run({ signal }) {
      const byUser = new Map<string, Map<number, Date>>();
      for await (const { key, modifiedAt } of d.store.list('avatars/')) {
        const [, userId = '', v] = key.split('/');
        const versions = byUser.get(userId) ?? new Map<number, Date>();
        const prev = versions.get(Number(v));
        if (!prev || modifiedAt > prev) versions.set(Number(v), modifiedAt);
        byUser.set(userId, versions);
      }
      const states = await d.directory.sweepStates([...byUser.keys()]);
      const cutoff = d.businessClock.now().getTime() - AVATAR_RETENTION_MS;
      const fresh = d.clock.now().getTime() - STALE_TEMP_AGE_MS;
      const departed: string[] = [];
      const doomed: [string, number][] = [];
      for (const [userId, versions] of byUser) {
        if (signal?.aborted) break;
        const state = states.get(userId);
        const top = Math.max(...versions.keys());
        if (state && !state.member) {
          const since =
            state.leftAt?.getTime() ?? Math.max(...[...versions.values()].map((t) => t.getTime()));
          if (since <= cutoff) {
            departed.push(userId);
            for (const v of versions.keys()) doomed.push([userId, v]);
          }
          continue;
        }
        for (const [v, modifiedAt] of versions) {
          if (state && v === state.version) continue;
          if (v === top && modifiedAt.getTime() > fresh) continue;
          if (modifiedAt.getTime() <= cutoff) doomed.push([userId, v]);
        }
      }
      if (departed.length > 0) await d.directory.clearDeparted(departed); // DB trước
      for (const [userId, v] of doomed) {
        for (const variant of VARIANTS) await d.store.delete(avatarFileKey(userId, v, variant)); // đĩa sau
      }
      return doomed.length;
    },
  };
}
