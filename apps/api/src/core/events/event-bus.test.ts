import { describe, expect, it } from 'vitest';

import { SpyLogger } from '../../../test/support';
import type { IDomainEvent } from '../domain';
import { InProcessEventBus } from './event-bus';

const event = (type: string, aggregateId = 'a1'): IDomainEvent => ({
  type,
  aggregateId,
  occurredAt: new Date('2026-10-15T08:00:00.000Z'),
});

describe('InProcessEventBus', () => {
  it('gọi handler đúng loại event, theo thứ tự đăng ký và thứ tự event', async () => {
    const bus = new InProcessEventBus(new SpyLogger());
    const seen: string[] = [];
    bus.subscribe('TaskCreated', (e) => void seen.push(`h1:${e.aggregateId}`));
    bus.subscribe('TaskCreated', async (e) => {
      await Promise.resolve();
      seen.push(`h2:${e.aggregateId}`);
    });
    bus.subscribe('TaskDeleted', (e) => void seen.push(`del:${e.aggregateId}`));

    await bus.publish([event('TaskCreated', 'a'), event('TaskDeleted', 'b'), event('Other')]);

    expect(seen).toEqual(['h1:a', 'h2:a', 'del:b']);
  });

  it('lỗi một handler được LOG (không nuốt im lặng) và không chặn handler/event sau', async () => {
    const logger = new SpyLogger();
    const bus = new InProcessEventBus(logger);
    const seen: string[] = [];
    bus.subscribe('TaskCreated', function brokenProjection() {
      throw new Error('boom');
    });
    bus.subscribe('TaskCreated', () => void seen.push('after'));

    await expect(bus.publish([event('TaskCreated', 'x')])).resolves.toBeUndefined();

    expect(seen).toEqual(['after']);
    const [entry] = logger.entries.filter((e) => e.level === 'error');
    expect(entry?.msg).toBe('event.handler_failed');
    expect(entry?.data).toMatchObject({
      eventType: 'TaskCreated',
      aggregateId: 'x',
      handler: 'brokenProjection',
    });
    expect((entry?.data['err'] as Error).message).toBe('boom');
  });

  it('handler ẩn danh vẫn được log với tên "anonymous"', async () => {
    const logger = new SpyLogger();
    const bus = new InProcessEventBus(logger);
    bus.subscribe('E', () => Promise.reject(new Error('x')));
    await bus.publish([event('E')]);
    expect(logger.entries[0]?.data['handler']).toBe('anonymous');
  });

  it('unsubscribe gỡ đúng handler', async () => {
    const bus = new InProcessEventBus(new SpyLogger());
    const seen: string[] = [];
    const off = bus.subscribe('E', () => void seen.push('a'));
    bus.subscribe('E', () => void seen.push('b'));
    off();
    off();
    await bus.publish([event('E')]);
    expect(seen).toEqual(['b']);
  });
});
