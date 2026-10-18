import { describe, expect, it } from 'vitest';

import { overriding } from './avatar-refs';

class Queries {
  readonly #rows = ['a', 'b'];
  list(): string[] {
    return [...this.#rows];
  }
  count(): number {
    return this.list().length;
  }
}

describe('overriding (T-068)', () => {
  it('giữ method trên prototype + field #private của instance class; chỉ thay method được ghi đè', () => {
    const q = new Queries();
    const wrapped = overriding(q, { list: () => ['x'] });
    expect(wrapped.list()).toEqual(['x']);
    // `count` không bị mất (lỗi của `{ ...q }`) và chạy với `this` gốc ⇒ đọc được #rows.
    expect(wrapped.count()).toBe(2);
  });
});
