import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';

import { IMAGE_TYPES } from '../domain/sniff-type';
import { IMAGE_WORKER_SOURCE } from './image-worker-source';

/** Phần của `Worker` mà pool dùng — test thay bằng worker giả. */
export interface WorkerLike {
  postMessage(value: unknown): void;
  on(event: 'message', fn: (value: unknown) => void): unknown;
  on(event: 'error', fn: (err: unknown) => void): unknown;
  on(event: 'exit', fn: (code: number) => void): unknown;
  terminate(): Promise<number>;
}

export const IMAGE_POOL_SIZE = 2;
export const IMAGE_MAX_QUEUE = 4;
export const IMAGE_TIMEOUT_MS = 10_000;
export const IMAGE_WORKER_IDLE_MS = 60_000;
export const IMAGE_WORKER_HEAP_MB = 256;
export const LIMIT_INPUT_PIXELS = 40_000_000;
/** Worker thật: mã nhúng (`eval`), sharp theo đường dẫn tuyệt đối, giới hạn heap V8. */
export function sharpWorkerFactory(): WorkerLike {
  const sharpPath = createRequire(import.meta.url).resolve('sharp');
  return new Worker(IMAGE_WORKER_SOURCE, {
    eval: true,
    workerData: { sharpPath, allowedFormats: IMAGE_TYPES, limitInputPixels: LIMIT_INPUT_PIXELS },
    resourceLimits: { maxOldGenerationSizeMb: IMAGE_WORKER_HEAP_MB },
  });
}
