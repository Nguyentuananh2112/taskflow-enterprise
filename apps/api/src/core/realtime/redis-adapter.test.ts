import { describe, expect, it } from 'vitest';

import { SpyLogger } from '../../../test/support';
import { guardPublisher } from './redis-adapter';

class FakeClient {
  readonly #secret = 'private-field';
  calls: unknown[][] = [];
  failure: 'reject' | 'throw' | undefined;

  publish(channel: string, message: string): Promise<number> {
    this.calls.push([channel, message]);
    if (this.failure === 'throw') throw new Error('sync');
    if (this.failure === 'reject') return Promise.reject(new Error('offline'));
    return Promise.resolve(1);
  }

  /** Method đọc trường #private — gọi với `this` là Proxy sẽ ném TypeError. */
  secret(): string {
    return this.#secret;
  }
}

describe('guardPublisher (T-028 H3)', () => {
  it('publish thành công ⇒ trả kết quả gốc', async () => {
    const client = new FakeClient();
    const guarded = guardPublisher(client, new SpyLogger());
    await expect(guarded.publish('c', 'm')).resolves.toBe(1);
    expect(client.calls).toEqual([['c', 'm']]);
  });

  it.each(['reject', 'throw'] as const)(
    'publish lỗi (%s) ⇒ không reject, trả 0, log warn tối đa 1 lần / 30s',
    async (failure) => {
      const client = new FakeClient();
      client.failure = failure;
      const logger = new SpyLogger();
      const guarded = guardPublisher(client, logger);
      await expect(guarded.publish('c', 'm')).resolves.toBe(0);
      await expect(guarded.publish('c', 'm')).resolves.toBe(0);
      expect(logger.messages('warn')).toEqual(['realtime.adapter_publish_failed']);
    },
  );

  it('thuộc tính khác chuyển tới client gốc; method chạy với `this` là client gốc', () => {
    const client = new FakeClient();
    const guarded = guardPublisher(client, new SpyLogger());
    expect(guarded.secret()).toBe('private-field');
    expect(guarded.calls).toBe(client.calls);
  });
});
