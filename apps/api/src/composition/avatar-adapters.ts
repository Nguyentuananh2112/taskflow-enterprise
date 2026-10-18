import { AVATAR_MAX_BYTES } from '@taskflow/contracts';

import type { IClock } from '../core/domain';
import { UnsupportedFileTypeError } from '../core/errors';
import { avatarFileKey, type FileKey } from '../core/files/domain/file-key';
import { extensionOf } from '../core/files/domain/file-name';
import { isImageType, sniffType } from '../core/files/domain/sniff-type';
import type { MediaUrlSigner } from '../core/files/media-url-signer';
import type { IFileStore, IImagePipeline, IMediaResolver } from '../core/files/ports';
import type {
  AvatarVariant,
  IAvatarBlobs,
  IAvatarChangedNotifier,
  IAvatarImages,
  IAvatarUrls,
} from '../modules/auth/application/ports/avatar.port';
import type { IAvatarDirectory } from '../modules/auth/application/ports/avatar-directory.port';
import type { AuthAvatarDeps } from '../modules/auth/auth.module';
import { avatarSweepTask } from './avatar-sweep';

export { ME_PATH } from '../modules/auth/presentation/avatar.routes';
import type { FilesBundle } from './files-setup';

/** Trần điểm ảnh của AVATAR (B, TL 18/10): 24 MP đủ cho ảnh điện thoại; ảnh chat giữ 40 MP chung. */
export const AVATAR_MAX_PIXELS = 24_000_000;
const VARIANTS: readonly AvatarVariant[] = ['256', '64'];

export function avatarImages(pipeline: IImagePipeline): IAvatarImages {
  return {
    async render(upload) {
      const sniffed = sniffType(
        upload.head,
        extensionOf(upload.name),
        upload.head.length === upload.sizeBytes,
      );
      if (!sniffed.ok || sniffed.type === 'zip' || !isImageType(sniffed.type)) {
        throw new UnsupportedFileTypeError();
      }
      const out = await pipeline.transform(
        await upload.readAll(),
        sniffed.type,
        VARIANTS.map((name) => ({ name, size: Number(name), fit: 'cover' as const })),
        { maxPixels: AVATAR_MAX_PIXELS },
      );
      return new Map(out.map((v) => [v.name as AvatarVariant, v.data]));
    },
  };
}

/** Version lớn nhất trong `avatars/<userId>/…` còn trên đĩa. */
async function versionsOnDisk(store: IFileStore, userId: string): Promise<Map<number, Date>> {
  const out = new Map<number, Date>();
  for await (const { key, modifiedAt } of store.list(`avatars/${userId.toLowerCase()}/`)) {
    const v = Number(key.split('/')[2]);
    const prev = out.get(v);
    if (!prev || modifiedAt > prev) out.set(v, modifiedAt);
  }
  return out;
}

export function avatarBlobs(store: IFileStore): IAvatarBlobs {
  const keys = (userId: string, version: number): FileKey[] =>
    VARIANTS.map((v) => avatarFileKey(userId, version, v));
  return {
    async latestVersion(userId) {
      return Math.max(0, ...(await versionsOnDisk(store, userId)).keys());
    },
    async place(userId, version, variants) {
      for (const variant of VARIANTS) {
        const data = variants.get(variant);
        if (!data) throw new Error(`thiếu biến thể ${variant}`);
        await store.put(data, {
          maxBytes: data.length,
          key: avatarFileKey(userId, version, variant),
        });
      }
    },
    async discard(userId, version) {
      for (const key of keys(userId, version)) await store.delete(key);
    },
    async markRemoved(userId, version, at) {
      for (const key of keys(userId, version)) await store.touch(key, at);
    },
  };
}

export function avatarUrls(signer: MediaUrlSigner): IAvatarUrls {
  return {
    urlsOf: (userId, version) => ({
      avatarUrl: signer.avatarUrl(userId, version, '64'),
      avatarUrlLarge: signer.avatarUrl(userId, version, '256'),
    }),
  };
}

export function avatarNotifier(realtime: {
  broadcastAvatarChanged(
    input: { userId: string; avatarUrl: string | null },
    meta: { actorId: string },
  ): Promise<void>;
}): IAvatarChangedNotifier {
  return {
    avatarChanged: ({ userId, avatarUrl, actorId }) =>
      realtime.broadcastAvatarChanged({ userId, avatarUrl }, { actorId }),
  };
}

/** `/media/avatars/:userId/:variant?v=` — chữ ký đúng ⇒ version phải KHỚP và chủ còn thuộc công ty (B M4 + B 18/10). */
export function avatarMediaResolver(directory: IAvatarDirectory): IMediaResolver {
  return {
    async resolve({ id, variant, version }) {
      const current = (await directory.activeVersions([id])).get(id);
      if (current !== version || (variant !== '256' && variant !== '64')) return null;
      return { key: avatarFileKey(id, version, variant), as: 'image' };
    },
  };
}

/**
 * Composition root (T-068): đăng ký `/media/avatars` (kiểm DB mỗi lần) + bước sweep `avatars`, trả deps ảnh đại diện
 * cho module auth (kho tệp + sharp 24 MP + URL ký + realtime).
 */
export function wireAvatarFiles(d: {
  files: FilesBundle;
  directory: IAvatarDirectory;
  realtime: Parameters<typeof avatarNotifier>[0];
  businessClock: IClock;
  clock: IClock;
}): AuthAvatarDeps {
  d.files.resolvers.register('avatars', avatarMediaResolver(d.directory));
  d.files.sweep.register(
    avatarSweepTask({
      store: d.files.store,
      directory: d.directory,
      businessClock: d.businessClock,
      clock: d.clock,
    }),
  );
  return {
    images: avatarImages(d.files.pipeline),
    blobs: avatarBlobs(d.files.store),
    urls: avatarUrls(d.files.signer),
    notifier: avatarNotifier(d.realtime),
    upload: d.files.upload(AVATAR_MAX_BYTES),
    clock: d.businessClock,
  };
}

/** `{ avatar }` cho `createAuthModule` khi có kho tệp; không ⇒ `{}` (test HTTP cũ). */
export function avatarAuthDeps(
  d: { files?: FilesBundle | undefined; clock: IClock },
  directory: IAvatarDirectory,
  realtime: Parameters<typeof avatarNotifier>[0],
  businessClock: IClock,
): { avatar?: AuthAvatarDeps } {
  if (!d.files) return {};
  return {
    avatar: wireAvatarFiles({ files: d.files, directory, realtime, businessClock, clock: d.clock }),
  };
}
