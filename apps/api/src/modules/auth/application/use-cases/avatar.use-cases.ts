import type { IClock } from '../../../../core/domain';
import { UnauthorizedError } from '../../../../core/errors';
import type { ILogger } from '../../../../core/logging/logger';
import type { IUnitOfWork } from '../../../../core/persistence/unit-of-work';
import type {
  AvatarUpload,
  AvatarUrls,
  IAvatarBlobs,
  IAvatarChangedNotifier,
  IAvatarImages,
  IAvatarUrls,
} from '../ports/avatar.port';
import type { IUserRepository } from '../ports/user-repository.port';

export interface AvatarUseCaseDeps {
  users: Pick<IUserRepository, 'lockAvatar' | 'setAvatarVersion'>;
  images: IAvatarImages;
  blobs: IAvatarBlobs;
  urls: IAvatarUrls;
  notifier: IAvatarChangedNotifier;
  uow: IUnitOfWork;
  /** Giờ NGHIỆP VỤ — mốc gỡ ảnh (blob giữ 30 ngày, sweep so cùng đồng hồ — D13, CLK-CH). */
  clock: IClock;
  logger: ILogger;
}

/** Bước sau commit lỗi không đổi kết quả (blob thừa ⇒ files-sweep dọn) — chỉ log tên + mã. */
function logAfterCommit(logger: ILogger, step: string) {
  return (err: unknown) =>
    logger.warn({ step, errName: (err as Error | undefined)?.name }, 'avatar.after_commit_failed');
}

/**
 * `PUT /me/avatar` (ADR-142). sharp chạy TRƯỚC transaction (không giữ khóa trong lúc chờ worker). Trong transaction:
 * khóa dòng ⇒ version mới ⇒ đặt blob (vẫn giữ khóa) ⇒ ghi version; đặt blob lỗi ⇒ rollback tự trả version (B). Sau
 * commit: xóa version cũ, phát `user:avatar-changed`.
 */
export class SetAvatarUseCase {
  constructor(private readonly d: AvatarUseCaseDeps) {}

  async execute(input: { userId: string; upload: AvatarUpload }): Promise<AvatarUrls> {
    const variants = await this.d.images.render(input.upload);
    const now = this.d.clock.now();
    const { version, previous } = await this.d.uow.run(async () => {
      const locked = await this.d.users.lockAvatar(input.userId);
      if (!locked) throw new UnauthorizedError();
      // Không dùng lại version còn blob trên đĩa (đã gỡ / mồ côi) — tránh URL trùng ảnh cũ trong cache + va khóa.
      const next =
        Math.max(locked.version ?? 0, await this.d.blobs.latestVersion(input.userId)) + 1;
      await this.d.blobs.place(input.userId, next, variants);
      if (!(await this.d.users.setAvatarVersion({ id: input.userId, version: next, at: now }))) {
        throw new UnauthorizedError();
      }
      return { version: next, previous: locked.version };
    });
    const urls = this.d.urls.urlsOf(input.userId, version);
    if (previous !== null) {
      await this.d.blobs
        .discard(input.userId, previous)
        .catch(logAfterCommit(this.d.logger, 'discard'));
    }
    await this.d.notifier
      .avatarChanged({ userId: input.userId, avatarUrl: urls.avatarUrl, actorId: input.userId })
      .catch(logAfterCommit(this.d.logger, 'notify'));
    return urls;
  }
}

/**
 * Gỡ ảnh — `DELETE /me/avatar` và `DELETE /hr/employees/:userId/avatar` (company gọi qua port, TRONG transaction của
 * nó để audit cùng commit). Không có ảnh ⇒ `null`, không phát event (idempotent). Blob giữ 30 ngày (D13).
 */
export class RemoveAvatarUseCase {
  constructor(private readonly d: Omit<AvatarUseCaseDeps, 'images'>) {}

  async execute(input: {
    userId: string;
    actorId: string;
  }): Promise<{ previousVersion: number | null }> {
    const now = this.d.clock.now();
    return this.d.uow.run(async () => {
      const locked = await this.d.users.lockAvatar(input.userId);
      if (!locked || locked.version === null) return { previousVersion: null };
      const previous = locked.version;
      await this.d.users.setAvatarVersion({ id: input.userId, version: null, at: now });
      this.d.uow.afterCommit(async () => {
        await this.d.blobs
          .markRemoved(input.userId, previous, now)
          .catch(logAfterCommit(this.d.logger, 'mark_removed'));
        await this.d.notifier.avatarChanged({
          userId: input.userId,
          avatarUrl: null,
          actorId: input.actorId,
        });
      });
      return { previousVersion: previous };
    });
  }
}
