import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import type { BusinessRuleViolationError } from '../../errors';
import {
  ImageProcessingBusyError,
  ImageProcessingUnavailableError,
  UnsupportedFileTypeError,
} from '../../errors';
import { DisabledImagePipeline } from './disabled-image-pipeline';
import { SharpImagePipeline, type WorkerLike } from './image-pipeline';

/** Worker giả: `respond` quyết định trả lời gì cho mỗi việc; `null` = không trả lời (treo). */
class FakeWorker extends EventEmitter implements WorkerLike {
  readonly received: Record<string, unknown>[] = [];
  terminated = false;

  constructor(
    private readonly respond: (msg: Record<string, unknown>) => Record<string, unknown> | null,
    ready = true,
  ) {
    super();
    if (ready) queueMicrotask(() => this.emit('message', { ready: true }));
  }

  postMessage(value: unknown): void {
    const msg = value as Record<string, unknown>;
    this.received.push(msg);
    const reply = this.respond(msg);
    if (reply) queueMicrotask(() => this.emit('message', { id: msg['id'], ...reply }));
  }

  terminate(): Promise<number> {
    this.terminated = true;
    queueMicrotask(() => this.emit('exit', 1));
    return Promise.resolve(1);
  }
}

const OK = {
  ok: true,
  variants: [{ name: '64', data: new Uint8Array([1, 2]), width: 64, height: 64 }],
};
const SPEC = [{ name: '64', size: 64, fit: 'cover' as const }];
const ruleOf = (e: unknown) => (e as BusinessRuleViolationError).details?.['rule'];

describe('SharpImagePipeline — pool (ADR-141, F-03b)', () => {
  it('trả biến thể dạng Buffer', async () => {
    const pipeline = new SharpImagePipeline({ factory: () => new FakeWorker(() => OK) });
    const [v] = await pipeline.transform(Buffer.from('x'), 'png', SPEC);
    expect(Buffer.isBuffer(v?.data)).toBe(true);
    expect(v).toMatchObject({ name: '64', width: 64, height: 64 });
    await pipeline.close();
  });

  it.each([
    ['FORMAT_MISMATCH', (e: unknown) => expect(e).toBeInstanceOf(UnsupportedFileTypeError)],
    ['UNREADABLE', (e: unknown) => expect(ruleOf(e)).toBe('IMAGE_UNREADABLE')],
    ['TOO_COMPLEX', (e: unknown) => expect(ruleOf(e)).toBe('IMAGE_TOO_COMPLEX')],
    ['lạ', (e: unknown) => expect(ruleOf(e)).toBe('IMAGE_UNREADABLE')],
  ])('lỗi worker %s ⇒ lỗi ứng dụng đúng loại', async (error, check) => {
    const pipeline = new SharpImagePipeline({
      factory: () => new FakeWorker(() => ({ ok: false, error })),
    });
    check(await pipeline.transform(Buffer.from('x'), 'png', SPEC).catch((e: unknown) => e));
    await pipeline.close();
  });

  it('2 đang chạy + 4 chờ ⇒ việc thứ 7: 503 IMAGE_PROCESSING_BUSY + Retry-After 5 (CC-CH-09)', async () => {
    const workers: FakeWorker[] = [];
    const pipeline = new SharpImagePipeline({
      timeoutMs: 60_000,
      factory: () => {
        const w = new FakeWorker(() => null); // treo
        workers.push(w);
        return w;
      },
    });
    await new Promise((r) => setTimeout(r, 0)); // worker sẵn sàng
    const pending = Array.from({ length: 6 }, () =>
      pipeline.transform(Buffer.from('x'), 'png', SPEC).catch(() => undefined),
    );
    const busy = await pipeline.transform(Buffer.from('x'), 'png', SPEC).catch((e: unknown) => e);
    expect(busy).toBeInstanceOf(ImageProcessingBusyError);
    expect((busy as ImageProcessingBusyError).headers).toEqual({ 'Retry-After': '5' });
    expect(workers.flatMap((w) => w.received)).toHaveLength(2); // mỗi worker đúng một việc
    await pipeline.close();
    await Promise.all(pending);
  });

  it('quá timeout ⇒ 422 IMAGE_TOO_COMPLEX, worker bị giết và dựng lại, việc chờ chạy tiếp', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const workers: FakeWorker[] = [];
      let call = 0;
      const pipeline = new SharpImagePipeline({
        poolSize: 1,
        timeoutMs: 10_000,
        factory: () => {
          const w = new FakeWorker(() => (++call === 1 ? null : OK));
          workers.push(w);
          return w;
        },
      });
      await Promise.resolve();
      const slow = pipeline.transform(Buffer.from('x'), 'png', SPEC).catch((e: unknown) => e);
      const next = pipeline.transform(Buffer.from('y'), 'png', SPEC);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(ruleOf(await slow)).toBe('IMAGE_TOO_COMPLEX');
      expect(workers[0]?.terminated).toBe(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(await next).toHaveLength(1);
      expect(workers).toHaveLength(2);
      await pipeline.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('worker chết giữa việc (vượt resourceLimits) ⇒ 422 IMAGE_TOO_COMPLEX, dựng worker mới', async () => {
    const workers: FakeWorker[] = [];
    const pipeline = new SharpImagePipeline({
      poolSize: 1,
      factory: () => {
        const w = new FakeWorker((msg) => {
          if (workers.length === 1) queueMicrotask(() => w.emit('exit', 1));
          return workers.length === 1 ? null : { ...OK, id: msg['id'] };
        });
        workers.push(w);
        return w;
      },
    });
    await new Promise((r) => setTimeout(r, 0));
    const err = await pipeline.transform(Buffer.from('x'), 'png', SPEC).catch((e: unknown) => e);
    expect(ruleOf(err)).toBe('IMAGE_TOO_COMPLEX');
    await new Promise((r) => setTimeout(r, 0));
    expect(await pipeline.transform(Buffer.from('x'), 'png', SPEC)).toHaveLength(1);
    await pipeline.close();
  });

  it('không nạp được sharp (worker lỗi trước khi sẵn sàng) ⇒ 503 UNAVAILABLE, gauge 0 (AV-06)', async () => {
    const onHealth = vi.fn();
    const pipeline = new SharpImagePipeline({
      onHealth,
      factory: () => {
        const w = new FakeWorker(() => null, false);
        queueMicrotask(() => w.emit('error', new Error('Cannot find module sharp')));
        return w;
      },
    });
    await new Promise((r) => setTimeout(r, 0));
    const err = await pipeline.transform(Buffer.from('x'), 'png', SPEC).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ImageProcessingUnavailableError);
    expect(onHealth).toHaveBeenCalledWith(false);
    expect(await pipeline.selfTest()).toBe(false);
    await pipeline.close();
  });

  it('factory ném ⇒ không nạp được ⇒ 503', async () => {
    const pipeline = new SharpImagePipeline({
      factory: () => {
        throw new Error('spawn failed');
      },
    });
    await expect(pipeline.transform(Buffer.from('x'), 'png', SPEC)).rejects.toBeInstanceOf(
      ImageProcessingUnavailableError,
    );
  });

  it('selfTest ok ⇒ true + gauge 1; dựng lại pool sau khi hỏng nếu sharp nạp lại được', async () => {
    const onHealth = vi.fn();
    let broken = true;
    const pipeline = new SharpImagePipeline({
      onHealth,
      factory: () => {
        if (broken) throw new Error('down');
        return new FakeWorker(() => ({ ok: true, variants: [] }));
      },
    });
    expect(await pipeline.selfTest()).toBe(false);
    broken = false;
    expect(await pipeline.selfTest()).toBe(true);
    expect(onHealth).toHaveBeenLastCalledWith(true);
    await pipeline.close();
  });

  it('close ⇒ việc chờ bị từ chối 503, việc mới bị từ chối', async () => {
    const pipeline = new SharpImagePipeline({
      poolSize: 1,
      factory: () => new FakeWorker(() => null),
    });
    await new Promise((r) => setTimeout(r, 0));
    const running = pipeline.transform(Buffer.from('x'), 'png', SPEC).catch((e: unknown) => e);
    const waiting = pipeline.transform(Buffer.from('x'), 'png', SPEC).catch((e: unknown) => e);
    await pipeline.close();
    expect(await waiting).toBeInstanceOf(ImageProcessingUnavailableError);
    expect(await running).toBeInstanceOf(ImageProcessingUnavailableError);
    await expect(pipeline.transform(Buffer.from('x'), 'png', SPEC)).rejects.toBeInstanceOf(
      ImageProcessingUnavailableError,
    );
  });

  it('khởi động LƯỜI: không worker tới việc đầu tiên (TL 18/10)', async () => {
    const factory = vi.fn(() => new FakeWorker(() => OK));
    const pipeline = new SharpImagePipeline({ factory });
    expect(factory).not.toHaveBeenCalled();
    expect(pipeline.workerCount).toBe(0);
    await pipeline.transform(Buffer.from('x'), 'png', SPEC);
    expect(factory).toHaveBeenCalledTimes(2);
    await pipeline.close();
  });

  it('worker rảnh quá idleMs ⇒ tắt; việc mới ⇒ dựng lại', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const workers: FakeWorker[] = [];
      const pipeline = new SharpImagePipeline({
        poolSize: 1,
        idleMs: 60_000,
        factory: () => {
          const w = new FakeWorker(() => OK);
          workers.push(w);
          return w;
        },
      });
      await pipeline.transform(Buffer.from('x'), 'png', SPEC);
      await vi.advanceTimersByTimeAsync(59_999);
      expect(pipeline.workerCount).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(pipeline.workerCount).toBe(0);
      expect(workers[0]?.terminated).toBe(true);
      await pipeline.transform(Buffer.from('y'), 'png', SPEC);
      expect(workers).toHaveLength(2);
      await pipeline.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('đếm "đầy" theo đang chạy + chờ, kể cả lúc worker đang khởi động (không 503 nhầm)', async () => {
    const pipeline = new SharpImagePipeline({
      timeoutMs: 60_000,
      factory: () => new FakeWorker(() => null),
    });
    const six = Array.from({ length: 6 }, () =>
      pipeline.transform(Buffer.from('x'), 'png', SPEC).catch((e: unknown) => e),
    );
    await new Promise((r) => setTimeout(r, 0));
    await pipeline.close();
    for (const r of await Promise.all(six)) expect(r).not.toBeInstanceOf(ImageProcessingBusyError);
  });

  it('DisabledImagePipeline (FILES_IMAGE_PIPELINE_DISABLED) ⇒ 503 UNAVAILABLE, selfTest false', async () => {
    const pipeline = new DisabledImagePipeline();
    await expect(pipeline.transform()).rejects.toBeInstanceOf(ImageProcessingUnavailableError);
    expect(await pipeline.selfTest()).toBe(false);
    await pipeline.close();
  });
});
