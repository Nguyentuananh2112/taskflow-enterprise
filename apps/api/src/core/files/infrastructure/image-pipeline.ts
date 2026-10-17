import {
  ImageProcessingBusyError,
  ImageProcessingUnavailableError,
  imageTooComplexError,
} from '../../errors';
import type { ImageType } from '../domain/sniff-type';
import type { IImagePipeline, ImageVariant, ImageVariantSpec } from '../ports';
import {
  IMAGE_MAX_QUEUE,
  IMAGE_POOL_SIZE,
  IMAGE_TIMEOUT_MS,
  IMAGE_WORKER_IDLE_MS,
  ERRORS,
  sharpWorkerFactory,
  type Job,
  type Reply,
  type Slot,
  type WorkerLike,
} from './sharp-worker';

export { sharpWorkerFactory, type WorkerLike } from './sharp-worker';

export interface ImagePipelineOptions {
  factory?: () => WorkerLike;
  /** ADR-141: pool 2 worker, hàng chờ 4, timeout 10 s, ~256 MB heap / worker, 40 MP. */
  poolSize?: number;
  maxQueue?: number;
  timeoutMs?: number;
  /** Worker rảnh quá chừng này thì tắt (khởi động LƯỜI — TL 18/10); việc mới ⇒ dựng lại. */
  idleMs?: number;
  onHealth?: (up: boolean) => void;
}

/** Worker chết trước khi sẵn sàng chừng này lần liên tiếp ⇒ coi như không nạp được sharp. */
const MAX_SPAWN_FAILURES = 2;

/**
 * Pool worker sharp (ADR-141): mỗi worker một việc; đầy (đang chạy + chờ ≥ pool + hàng chờ) ⇒ 503 BUSY; quá giờ ⇒
 * giết + 422. Khởi động LƯỜI (TL 18/10): không dựng worker tới việc đầu tiên, rảnh `idleMs` ⇒ tắt — tiến trình
 * API không đụng ảnh (suite S/E2E) không tốn RAM cho worker.
 */
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
      idleMs: options.idleMs ?? IMAGE_WORKER_IDLE_MS,
      onHealth: options.onHealth ?? (() => undefined),
    };
  }

  /** Số worker đang sống (test / gauge). */
  get workerCount(): number {
    return this.#slots.length;
  }

  transform(
    input: Buffer,
    expected: ImageType,
    variants: readonly ImageVariantSpec[],
    options: { maxPixels?: number } = {},
  ) {
    const maxPixels = options.maxPixels ?? 0;
    return this.#enqueue(
      { kind: 'transform', input: Uint8Array.from(input), expected, variants, maxPixels },
      true,
    );
  }

  async selfTest(): Promise<boolean> {
    if (!this.#up && !this.#closed) {
      this.#up = true; // thử dựng lại pool (worker dựng ở #enqueue)
      this.#spawnFailures = 0;
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
      clearTimeout(slot.idle);
      slot.job?.reject(new ImageProcessingUnavailableError()); // việc đang chạy cũng phải kết thúc
      slot.job = undefined;
    }
    await Promise.all(slots.map((s) => s.worker.terminate()));
  }

  #enqueue(message: Record<string, unknown>, limited: boolean): Promise<ImageVariant[]> {
    if (!this.#up || this.#closed) return Promise.reject(new ImageProcessingUnavailableError());
    const inFlight = this.#slots.filter((s) => s.job).length;
    if (limited && inFlight + this.#queue.length >= this.#o.poolSize + this.#o.maxQueue) {
      return Promise.reject(new ImageProcessingBusyError());
    }
    return new Promise((resolve, reject) => {
      this.#queue.push({ id: this.#nextId++, message, resolve, reject });
      this.#ensureWorkers();
      this.#pump();
    });
  }

  /** Dựng đủ `poolSize` worker khi có việc. Số lần cố định: factory ném ⇒ slot không tăng ⇒ không lặp vô hạn. */
  #ensureWorkers(): void {
    const missing = this.#o.poolSize - this.#slots.length;
    for (let i = 0; i < missing && this.#up && !this.#closed; i++) this.#spawn();
  }

  /** Rảnh (sẵn sàng, không việc) ⇒ hẹn tắt sau `idleMs`; có việc ⇒ hủy hẹn. */
  #armIdle(slot: Slot): void {
    clearTimeout(slot.idle);
    if (slot.dead || !slot.ready || slot.job) return;
    slot.idle = setTimeout(() => {
      if (slot.dead || slot.job) return;
      slot.dead = true;
      this.#slots.splice(this.#slots.indexOf(slot), 1);
      void slot.worker.terminate();
    }, this.#o.idleMs);
    slot.idle.unref();
  }

  #pump(): void {
    for (const slot of this.#slots) {
      if (!slot.ready || slot.job || slot.dead) continue;
      const job = this.#queue.shift();
      if (!job) return;
      slot.job = job;
      clearTimeout(slot.idle);
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
        this.#armIdle(slot);
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
    this.#armIdle(slot);
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
    clearTimeout(slot.idle);
    slot.job?.reject(imageTooComplexError());
    slot.job = undefined;
    this.#slots.splice(this.#slots.indexOf(slot), 1);
    if (!slot.ready) this.#spawnFailed();
    else if (this.#queue.length > 0) this.#ensureWorkers(); // lười: chỉ dựng lại khi còn việc chờ
  }

  #spawnFailed(): void {
    this.#spawnFailures += 1;
    if (this.#spawnFailures >= MAX_SPAWN_FAILURES || this.#closed) {
      if (this.#up) this.#o.onHealth(false);
      this.#up = false;
      this.#failQueue(new ImageProcessingUnavailableError());
    } else if (this.#queue.length > 0) this.#spawn();
  }

  #failQueue(err: Error): void {
    for (const job of this.#queue.splice(0)) job.reject(err);
  }
}
