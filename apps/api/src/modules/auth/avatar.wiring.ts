import type { RequestHandler, Router } from 'express';

import type { IClock } from '../../core/domain';
import type { HttpResponder } from '../../core/http/envelope';
import type { RateLimitRule } from '../../core/http/rate-limit/rules';
import type { ILogger } from '../../core/logging/logger';
import type { IUnitOfWork } from '../../core/persistence/unit-of-work';
import type {
  AvatarUrls,
  IAvatarBlobs,
  IAvatarChangedNotifier,
  IAvatarImages,
  IAvatarUrls,
} from './application/ports/avatar.port';
import type { ICompanySessionGate } from './application/ports/collaborators.port';
import type { IUserRepository } from './application/ports/user-repository.port';
import { RemoveAvatarUseCase, SetAvatarUseCase } from './application/use-cases/avatar.use-cases';
import { avatarRoutes } from './presentation/avatar.routes';

/** Mốc 6 (ADR-142): hạ tầng ảnh đại diện composition tiêm vào module auth. */
export interface AuthAvatarDeps {
  images: IAvatarImages;
  blobs: IAvatarBlobs;
  urls: IAvatarUrls;
  notifier: IAvatarChangedNotifier;
  /** `rawUpload` với trần avatar (5 MB). */
  upload: RequestHandler;
  /** Giờ NGHIỆP VỤ — mốc gỡ ảnh (blob giữ 30 ngày, D13). */
  clock: IClock;
}

export type AvatarWiring = ReturnType<typeof createAvatarWiring>;

export function createAvatarWiring(d: {
  avatar: AuthAvatarDeps;
  users: IUserRepository;
  uow: IUnitOfWork;
  logger: ILogger;
  authenticate: RequestHandler;
  company: Pick<ICompanySessionGate, 'isActive'>;
  limit: (rules: readonly RateLimitRule[]) => RequestHandler[];
  responder: HttpResponder;
}): {
  meRouter: Router;
  removeAvatar: RemoveAvatarUseCase;
  avatarOf: (userId: string) => Promise<AvatarUrls | null>;
} {
  const a = d.avatar;
  const deps = { users: d.users, blobs: a.blobs, urls: a.urls, notifier: a.notifier, uow: d.uow };
  const base = { ...deps, clock: a.clock, logger: d.logger };
  const removeAvatar = new RemoveAvatarUseCase(base);
  const meRouter = avatarRoutes({
    setAvatar: new SetAvatarUseCase({ ...base, images: a.images }),
    removeAvatar,
    authenticate: d.authenticate,
    company: d.company,
    upload: a.upload,
    limit: d.limit,
    responder: d.responder,
  });
  // Người đang đăng nhập — đã qua cổng công ty ở GET /me / login ⇒ chỉ cần version.
  const avatarOf = async (userId: string) => {
    const version = (await d.users.avatarVersions([userId])).get(userId);
    return version === undefined ? null : a.urls.urlsOf(userId, version);
  };
  return { meRouter, removeAvatar, avatarOf };
}
