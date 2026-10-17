import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';

import {
  ImageProcessingBusyError,
  ImageProcessingUnavailableError,
  imageTooComplexError,
  imageUnreadableError,
  UnsupportedFileTypeError,
} from '../../errors';
import { IMAGE_TYPES, type ImageType } from '../domain/sniff-type';
import type { IImagePipeline, ImageVariant, ImageVariantSpec } from '../ports';
import { IMAGE_WORKER_SOURCE } from './image-worker-source';

/** Phần của `Worker` mà pool dùng — test thay bằng worker giả. */
export interface WorkerLike {
  postMessage(value: unknown): void;
  on(event: 'message', fn: (value: unknown) => void): unknown;
  on(event: 'error', fn: (err: unknown) => void): unknown;
  on(event: 'exit', fn: (code: number) => void): unknown;
  terminate(): Promise<number>;
}

export interface ImagePipelineOptions {
  factory?: () => WorkerLike;
  /** ADR-141: pool 2 worker, hàng chờ 4, timeout 10 s, ~256 MB heap / worker, 40 MP. */
  poolSize?: number;
  maxQueue?: number;
  timeoutMs?: number;
  onHealth?: (up: boolean) => void;
}

export const IMAGE_POOL_SIZE = 2;
export const IMAGE_MAX_QUEUE = 4;
export const IMAGE_TIMEOUT_MS = 10_000;
export const IMAGE_WORKER_HEAP_MB = 256;
export const LIMIT_INPUT_PIXELS = 40_000_000;
/** Worker chết trước khi sẵn sàng chừng này lần liên tiếp ⇒ coi như không nạp được sharp. */
const MAX_SPAWN_FAILURES = 2;

type Reply =
  { id: number; ok: true; variants: ImageVariant[] } | { id: number; ok: false; error: string };
interface Job {
  id: number;
  message: Record<string, unknown>;
  resolve: (v: ImageVariant[]) => void;
  reject: (e: unknown) => void;
}
interface Slot {
  worker: WorkerLike;
  ready: boolean;
  dead: boolean;
  job?: Job | undefined;
  timer?: NodeJS.Timeout | undefined;
}

/** Worker thật: mã nhúng (`eval`), sharp theo đường dẫn tuyệt đối, giới hạn heap V8. */
export function sharpWorkerFactory(): WorkerLike {
  const sharpPath = createRequire(import.meta.url).resolve('sharp');
  return new Worker(IMAGE_WORKER_SOURCE, {
    eval: true,
    workerData: { sharpPath, allowedFormats: IMAGE_TYPES, limitInputPixels: LIMIT_INPUT_PIXELS },
    resourceLimits: { maxOldGenerationSizeMb: IMAGE_WORKER_HEAP_MB },
  });
}

const ERRORS: Readonly<Record<string, () => Error>> = {
  FORMAT_MISMATCH: () => new UnsupportedFileTypeError(),
  TOO_COMPLEX: () => imageTooComplexError(),
  UNREADABLE: () => imageUnreadableError(),
};

/** Pool worker sharp (ADR-141): mỗi worker một việc; đầy (đang chạy + chờ) ⇒ 503 BUSY; quá giờ ⇒ giết + 422. */
export class SharpImagePipeline implements IImagePipeline {
  readonly #slots: Slot[] = [];
  readonly #queue: Job[] = [];
  readonly #factory: () => WorkerLike;
  readonly #o: Required<Omit<ImagePipelineOptions, 'factory'>>;
  #nextId = 1;
  #spawnFailures = 0;
  #up = true;
  #closed = false;

  constructor(options: ImagePipelineOptions = {}) {
    this.#factory = options.factory ?? sharpWorkerFactory;
    this.#o = {
      poolSize: options.poolSize ?? IMAGE_POOL_SIZE,
      maxQueue: options.maxQueue ?? IMAGE_MAX_QUEUE,
      timeoutMs: options.timeoutMs ?? IMAGE_TIMEOUT_MS,
      onHealth: options.onHealth ?? (() => undefined),
    };
    for (let i = 0; i < this.#o.poolSize; i++) this.#spawn();
  }

  transform(input: Buffer, expected: ImageType, variants: readonly ImageVariantSpec[]) {
    return this.#enqueue(
      { kind: 'transform', input: Uint8Array.from(input), expected, variants },
      true,
    );
  }

  async selfTest(): Promise<boolean> {
    if (!this.#up && !this.#closed) {
      this.#up = true; // thử dựng lại pool
      this.#spawnFailures = 0;
      // Số lần cố định (không `while slots < poolSize`): factory ném ⇒ slot không tăng ⇒ lặp vô hạn.
      const missing = this.#o.poolSize - this.#slots.length;
      for (let i = 0; i < missing && this.#up; i++) this.#spawn();
    }
    const ok = await this.#enqueue({ kind: 'selfTest' }, false).then(
      () => true,
      () => false,
    );
    this.#o.onHealth(ok && this.#up);
    return ok && this.#up;
  }

  async close(): Promise<void> {
    this.#closed = true;
    this.#failQueue(new ImageProcessingUnavailableError());
    const slots = this.#slots.splice(0);
    for (const slot of slots) {
      slot.dead = true;
      clearTimeout(slot.timer);
      slot.job?.reject(new ImageProcessingUnavailableError()); // việc đang chạy cũng phải kết thúc
      slot.job = undefined;
    }
    await Promise.all(slots.map((s) => s.worker.terminate()));
  }

  #enqueue(message: Record<string, unknown>, limited: boolean): Promise<ImageVariant[]> {
    if (!this.#up || this.#closed) return Promise.reject(new ImageProcessingUnavailableError());
    const idle = this.#slots.some((s) => s.ready && !s.job);
    if (limited && !idle && this.#queue.length >= this.#o.maxQueue) {
      return Promise.reject(new ImageProcessingBusyError());
    }
    return new Promise((resolve, reject) => {
      this.#queue.push({ id: this.#nextId++, message, resolve, reject });
      this.#pump();
    });
  }

  #pump(): void {
    for (const slot of this.#slots) {
      if (!slot.ready || slot.job || slot.dead) continue;
      const job = this.#queue.shift();
      if (!job) return;
      slot.job = job;
      slot.timer = setTimeout(() => this.#timeout(slot), this.#o.timeoutMs);
      slot.worker.postMessage({ id: job.id, ...job.message });
    }
  }

  #spawn(): void {
    let worker: WorkerLike;
    try {
      worker = this.#factory();
    } catch {
      this.#spawnFailed();
      return;
    }
    const slot: Slot = { worker, ready: false, dead: false };
    this.#slots.push(slot);
    worker.on('message', (raw) => {
      const msg = raw as { ready?: boolean } & Partial<Reply>;
      if (msg.ready) {
        slot.ready = true;
        this.#spawnFailures = 0;
        this.#pump();
      } else this.#settle(slot, msg as Reply);
    });
    worker.on('error', () => this.#lost(slot));
    worker.on('exit', () => this.#lost(slot));
  }

  #settle(slot: Slot, reply: Reply): void {
    const job = slot.job;
    if (!job || job.id !== reply.id) return;
    clearTimeout(slot.timer);
    slot.job = undefined;
    if (reply.ok) job.resolve(reply.variants.map((v) => ({ ...v, data: Buffer.from(v.data) })));
    else job.reject((ERRORS[reply.error] ?? ERRORS['UNREADABLE']!)());
    this.#pump();
  }

  /** Quá `timeoutMs`: ảnh quá phức tạp ⇒ 422; giết worker (libvips không hủy được giữa chừng), dựng mới. */
  #timeout(slot: Slot): void {
    slot.job?.reject(imageTooComplexError());
    slot.job = undefined;
    void slot.worker.terminate();
    this.#lost(slot);
  }

  /** Worker chết (lỗi nạp sharp, vượt `resourceLimits`, bị giết): việc đang chạy ⇒ 422; dựng worker thay. */
  #lost(slot: Slot): void {
    if (slot.dead) return;
    slot.dead = true;
    clearTimeout(slot.timer);
    slot.job?.reject(imageTooComplexError());
    slot.job = undefined;
    this.#slots.splice(this.#slots.indexOf(slot), 1);
    if (!slot.ready) this.#spawnFailed();
    else if (!this.#closed) this.#spawn();
  }

  #spawnFailed(): void {
    this.#spawnFailures += 1;
    if (this.#spawnFailures >= MAX_SPAWN_FAILURES || this.#closed) {
      if (this.#up) this.#o.onHealth(false);
      this.#up = false;
      this.#failQueue(new ImageProcessingUnavailableError());
    } else this.#spawn();
  }

  #failQueue(err: Error): void {
    for (const job of this.#queue.splice(0)) job.reject(err);
  }
}
