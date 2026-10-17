import { randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { RequestHandler, Router } from 'express';

import type { Env } from '../config/env';
import type { IClock } from '../core/domain';
import { DisabledImagePipeline } from '../core/files/infrastructure/disabled-image-pipeline';
import { SharpImagePipeline } from '../core/files/infrastructure/image-pipeline';
import { LocalFileStore } from '../core/files/infrastructure/local-file-store';
import { storeUsageBytes } from '../core/files/infrastructure/local-fs';
import { MediaResolverRegistry } from '../core/files/media-resolver-registry';
import { MediaUrlSigner } from '../core/files/media-url-signer';
import type { IFileStore, IImagePipeline } from '../core/files/ports';
import { mediaRouter } from '../core/files/presentation/media-router';
import { rawUpload } from '../core/files/presentation/raw-upload';
import { StorageQuota } from '../core/files/storage-quota';
import { UploadSlots } from '../core/files/upload-slots';
import type { ILogger } from '../core/logging/logger';
import type { AppMetrics } from '../core/observability/metrics';

/** ADR-141: avatar 24 giờ, ảnh chat 1 giờ, URL tải 60 s; im lặng 15 s / tổng 180 s; đối soát kho 60 s. */
export const FILES_DEFAULTS = {
  avatarBucketSec: 86_400,
  imageBucketSec: 3_600,
  downloadTtlSec: 60,
  uploadIdleMs: 15_000,
  uploadTotalMs: 180_000,
  usageCacheMs: 60_000,
  orphanTtlSec: 86_400,
  healthIntervalMs: 5 * 60_000,
} as const;

/** Mọi thứ của kho tệp mà module (avatar T-068, chat T-069) và app cần — dựng MỘT lần ở composition root. */
export interface FilesBundle {
  store: IFileStore;
  pipeline: IImagePipeline;
  signer: MediaUrlSigner;
  /** Module sở hữu dữ liệu đăng ký kiểm DB cho `/media` theo kind. */
  resolvers: MediaResolverRegistry;
  quota: StorageQuota;
  /** Middleware upload nhị phân theo trần (avatar 5 MB, tệp chat 20 MB). */
  upload(maxBytes: number): RequestHandler;
  /** Router `/api/v1/media` (không Bearer). */
  media: Router;
  orphanTtlSec: number;
  /** Tự kiểm worker sharp lúc khởi động + mỗi 5 phút (không chặn `/readyz`). */
  startHealthChecks(): void;
  close(): Promise<void>;
}

export interface FilesSetupDeps {
  env: Env;
  clock: IClock;
  logger: ILogger;
  metrics?: AppMetrics;
  /** Hạn mức IP của `/media` (`RATE_LIMIT_RULES.media`). */
  mediaRateLimit?: RequestHandler;
  /** Link "Quay lại" của trang lỗi `/media`. */
  webOrigin: string;
}

async function storeDir(env: Env): Promise<string> {
  if (env.FILE_STORE_DIR) return env.FILE_STORE_DIR; // staging/production: env.ts bắt buộc
  const dir = path.join(os.tmpdir(), 'taskflow-files');
  await mkdir(dir, { recursive: true });
  return dir;
}

function urlSecret(env: Env, logger: ILogger): string {
  if (env.FILE_URL_SECRET) return env.FILE_URL_SECRET; // staging/production: env.ts bắt buộc
  logger.warn({}, 'files.url_secret_ephemeral'); // local/test: URL ký cũ mất hiệu lực khi restart
  return randomBytes(32).toString('base64url');
}

export async function createFiles(d: FilesSetupDeps): Promise<FilesBundle> {
  const { env, logger } = d;
  const root = await storeDir(env);
  const cwd = process.cwd();
  // Kho không được nằm trong thư mục ứng dụng (ADR-141); cwd = '/' (container lạ) ⇒ bỏ kiểm thay vì chặn hết.
  const store = await LocalFileStore.create(root, {
    forbiddenParents: cwd === path.parse(cwd).root ? [] : [cwd],
  });
  // -1 = chưa tự kiểm (pool lười — TL 18/10); 1 / 0 sau lần tự kiểm đầu tiên (sau khi ready).
  let workerUp = -1;
  const pipeline: IImagePipeline = env.FILES_IMAGE_PIPELINE_DISABLED
    ? new DisabledImagePipeline()
    : new SharpImagePipeline({ onHealth: (up) => (workerUp = up ? 1 : 0) });
  const quota = new StorageQuota(
    () => storeUsageBytes(root),
    env.FILE_STORE_MAX_BYTES,
    env.FILE_STORE_USAGE_CACHE_MS ?? FILES_DEFAULTS.usageCacheMs,
  );
  const secret = urlSecret(env, logger);
  const signer = new MediaUrlSigner(
    {
      baseUrl: env.MEDIA_BASE_URL,
      secret,
      avatarBucketSec: env.MEDIA_URL_AVATAR_BUCKET_SECONDS ?? FILES_DEFAULTS.avatarBucketSec,
      imageBucketSec: env.MEDIA_URL_IMAGE_BUCKET_SECONDS ?? FILES_DEFAULTS.imageBucketSec,
      downloadTtlSec: env.MEDIA_URL_DOWNLOAD_TTL_SECONDS ?? FILES_DEFAULTS.downloadTtlSec,
    },
    d.clock,
  );
  const resolvers = new MediaResolverRegistry();
  const slots = new UploadSlots();
  const media = mediaRouter({
    store,
    resolver: resolvers,
    secrets: {
      current: secret,
      ...(env.FILE_URL_SECRET_PREVIOUS ? { previous: env.FILE_URL_SECRET_PREVIOUS } : {}),
    },
    clock: d.clock,
    logger,
    corp: env.MEDIA_CORP,
    backUrl: d.webOrigin,
    ...(d.mediaRateLimit ? { rateLimit: d.mediaRateLimit } : {}),
  });
  d.metrics?.gauge(
    'files_image_worker_up',
    'Worker sharp tự kiểm: 1 = được, 0 = không, -1 = chưa kiểm',
    () => workerUp,
  );

  let timer: NodeJS.Timeout | undefined;
  const check = async () => {
    const ok = await pipeline.selfTest();
    workerUp = ok ? 1 : 0;
    if (!ok) logger.error({}, 'files.image_pipeline_unavailable');
    const ratio = await quota.ratio().catch(() => 0);
    if (ratio >= 0.9) logger.warn({ ratio }, 'files.storage_nearly_full');
  };

  return {
    store,
    pipeline,
    signer,
    resolvers,
    quota,
    media,
    orphanTtlSec: env.FILES_ORPHAN_TTL_SECONDS ?? FILES_DEFAULTS.orphanTtlSec,
    upload: (maxBytes) =>
      rawUpload({
        store,
        slots,
        quota,
        maxBytes,
        idleTimeoutMs: env.UPLOAD_IDLE_TIMEOUT_MS ?? FILES_DEFAULTS.uploadIdleMs,
        totalTimeoutMs: FILES_DEFAULTS.uploadTotalMs,
      }),
    startHealthChecks: () => {
      void check();
      timer = setInterval(() => void check(), FILES_DEFAULTS.healthIntervalMs);
      timer.unref();
    },
    close: async () => {
      clearInterval(timer);
      await pipeline.close();
    },
  };
}
