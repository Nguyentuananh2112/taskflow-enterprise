import { describe, expect, it } from 'vitest';

import { AggregateRoot, Entity, type IDomainEvent } from './index';

interface Renamed extends IDomainEvent {
  type: 'Renamed';
  name: string;
}

class Thing extends AggregateRoot<Renamed> {
  constructor(id: string) {
    super(id);
  }

  rename(name: string, at: Date): void {
    this.addDomainEvent({ type: 'Renamed', aggregateId: this.id, occurredAt: at, name });
  }
}

class Other extends Entity {
  constructor(id: string) {
    super(id);
  }
}

const AT = new Date('2026-10-15T08:00:00.000Z');

describe('AggregateRoot', () => {
  it('pullDomainEvents trả event theo thứ tự phát sinh rồi xóa danh sách', () => {
    const thing = new Thing('t1');
    thing.rename('a', AT);
    thing.rename('b', AT);
    expect(thing.hasPendingDomainEvents).toBe(true);

    expect(thing.pullDomainEvents().map((e) => e.name)).toEqual(['a', 'b']);
    expect(thing.hasPendingDomainEvents).toBe(false);
    expect(thing.pullDomainEvents()).toEqual([]);
  });

  it('event phát sinh sau khi pull không lẫn vào mảng đã trả', () => {
    const thing = new Thing('t1');
    thing.rename('a', AT);
    const first = thing.pullDomainEvents();
    thing.rename('b', AT);
    expect(first).toHaveLength(1);
    expect(thing.pullDomainEvents().map((e) => e.name)).toEqual(['b']);
  });
});

describe('Entity.equals', () => {
  it('cùng lớp và cùng id ⇒ bằng nhau', () => {
    expect(new Thing('x').equals(new Thing('x'))).toBe(true);
  });

  it('khác id, khác lớp, null/undefined ⇒ khác', () => {
    const thing = new Thing('x');
    expect(thing.equals(new Thing('y'))).toBe(false);
    expect(thing.equals(new Other('x') as unknown as Thing)).toBe(false);
    expect(thing.equals(null)).toBe(false);
    expect(thing.equals(undefined)).toBe(false);
    expect(thing.equals(thing)).toBe(true);
  });
});
